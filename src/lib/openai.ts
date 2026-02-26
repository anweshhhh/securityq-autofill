export const OPENAI_EMBEDDINGS_MODEL = "text-embedding-3-small";
export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";

const OPENAI_API_BASE = "https://api.openai.com/v1";

export type GroundedAnswerModelCitation = {
  chunkId: string;
  quotedSnippet: string;
};

export type GroundedAnswerModelOutput = {
  answer: string;
  citations: GroundedAnswerModelCitation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
};

export type EvidenceExtractorGateOverall = "FOUND" | "PARTIAL" | "NOT_FOUND";

export type EvidenceExtractorGateItem = {
  requirement: string;
  value: string | null;
  supportingChunkIds: string[];
};

export type EvidenceSufficiencyModelOutput = {
  requirements: string[];
  extracted: EvidenceExtractorGateItem[];
  overall: EvidenceExtractorGateOverall;
  hadShapeRepair: boolean;
  extractorInvalid: boolean;
  invalidReason: "NO_VALID_EXTRACTED_ITEMS" | null;
};

export type LegacyEvidenceSufficiencyModelOutput = {
  sufficient: boolean;
  missingPoints: string[];
  supportingChunkIds: string[];
};

type RetrievedSnippet = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
};

const EXTRACTOR_LIST_LIMITS = {
  requirements: 12,
  extracted: 16,
  supportingChunkIds: 5
} as const;

const REQUIREMENT_MAP_IGNORED_KEYS = new Set([
  "requirements",
  "extracted",
  "overall",
  "supportingchunkids",
  "supporting_chunk_ids",
  "chunkids",
  "chunk_ids",
  "chunks"
]);

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return apiKey;
}

async function requestOpenAI(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function createEmbedding(input: string): Promise<number[]> {
  const payload = (await requestOpenAI("/embeddings", {
    model: OPENAI_EMBEDDINGS_MODEL,
    input
  })) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length !== 1536) {
    throw new Error("Embedding response is missing or has unexpected dimensions");
  }

  return embedding;
}

function toSnippetText(snippets: RetrievedSnippet[]): string {
  return snippets
    .map(
      (snippet, index) =>
        `Snippet ${index + 1}\nchunkId: ${snippet.chunkId}\ndocName: ${snippet.docName}\ntext: ${snippet.quotedSnippet}`
    )
    .join("\n\n");
}

function toAllowedChunkIdsCsv(snippets: RetrievedSnippet[]): string {
  return dedupeStrings(
    snippets
      .map((snippet) => snippet.chunkId.trim())
      .filter((chunkId) => chunkId.length > 0),
    snippets.length
  ).join(",");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRequirementMatchKey(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeRequirementText(value: string): string {
  return value.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeStrings(values: string[], limit: number): string[] {
  return Array.from(new Set(values)).slice(0, limit);
}

function collectStringLeaves(value: unknown, output: string[], depth = 0) {
  if (depth > 6) {
    return;
  }

  const asString = toStringOrNull(value);
  if (asString) {
    output.push(asString);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLeaves(item, output, depth + 1);
    }
    return;
  }

  if (isRecord(value)) {
    for (const nested of Object.values(value)) {
      collectStringLeaves(nested, output, depth + 1);
    }
  }
}

function looksLikeRequirementKey(key: string): boolean {
  const normalized = normalizeRequirementMatchKey(key);
  if (!normalized || normalized.length < 3) {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return false;
  }

  if (REQUIREMENT_MAP_IGNORED_KEYS.has(normalized.replace(/\s+/g, ""))) {
    return false;
  }

  return true;
}

function toChunkIdList(raw: unknown): string[] {
  if (typeof raw === "string") {
    const single = raw.trim();
    return single ? [single] : [];
  }

  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  return [];
}

function normalizeChunkIds(raw: unknown, allowedChunkIds: Set<string>): string[] {
  return dedupeStrings(
    toChunkIdList(raw).filter((chunkId) => allowedChunkIds.has(chunkId)),
    EXTRACTOR_LIST_LIMITS.supportingChunkIds
  );
}

function getCandidateChunkCarrier(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  if ("supportingChunkIds" in raw) {
    return raw.supportingChunkIds;
  }

  if ("chunkIds" in raw) {
    return raw.chunkIds;
  }

  if ("chunks" in raw) {
    return raw.chunks;
  }

  return raw;
}

function extractTopLevelRequirementChunkMap(
  raw: unknown,
  allowedChunkIds: Set<string>
): { map: Map<string, string[]>; hadShapeRepair: boolean } {
  const map = new Map<string, string[]>();

  if (!isRecord(raw)) {
    return { map, hadShapeRepair: false };
  }

  let hadShapeRepair = false;
  for (const [key, value] of Object.entries(raw)) {
    const requirement = normalizeRequirementText(key);
    if (!requirement) {
      continue;
    }

    const chunkIds = normalizeChunkIds(getCandidateChunkCarrier(value), allowedChunkIds);
    if (chunkIds.length === 0) {
      continue;
    }

    hadShapeRepair = true;
    map.set(normalizeRequirementMatchKey(requirement), chunkIds);
  }

  return { map, hadShapeRepair };
}

function normalizeRequirementList(raw: unknown): { requirements: string[]; hadShapeRepair: boolean } {
  if (Array.isArray(raw)) {
    return {
      requirements: dedupeStrings(
        raw
          .filter((value): value is string => typeof value === "string")
          .map((value) => normalizeRequirementText(value))
          .filter((value) => value.length > 0),
        EXTRACTOR_LIST_LIMITS.requirements
      ),
      hadShapeRepair: false
    };
  }

  const asSingle = toStringOrNull(raw);
  if (asSingle) {
    return {
      requirements: [normalizeRequirementText(asSingle)],
      hadShapeRepair: true
    };
  }

  if (!isRecord(raw)) {
    return {
      requirements: [],
      hadShapeRepair: false
    };
  }

  const valuesAsStrings = Object.values(raw)
    .map((value) => toStringOrNull(value))
    .filter((value): value is string => value !== null)
    .map((value) => normalizeRequirementText(value))
    .filter((value) => value.length > 0);
  if (valuesAsStrings.length > 0) {
    return {
      requirements: dedupeStrings(valuesAsStrings, EXTRACTOR_LIST_LIMITS.requirements),
      hadShapeRepair: true
    };
  }

  const keyCandidates = Object.keys(raw)
    .filter((key) => looksLikeRequirementKey(key))
    .map((key) => normalizeRequirementText(key))
    .filter((value) => value.length > 0);
  if (keyCandidates.length > 0) {
    return {
      requirements: dedupeStrings(keyCandidates, EXTRACTOR_LIST_LIMITS.requirements),
      hadShapeRepair: true
    };
  }

  const leaves: string[] = [];
  collectStringLeaves(raw, leaves);

  return {
    requirements: dedupeStrings(
      leaves.map((value) => normalizeRequirementText(value)).filter((value) => value.length > 0),
      EXTRACTOR_LIST_LIMITS.requirements
    ),
    hadShapeRepair: true
  };
}

function normalizeExtractedItem(params: {
  requirement: string;
  rawValue: unknown;
  rawSupportingChunkIds: unknown;
  allowedChunkIds: Set<string>;
}): EvidenceExtractorGateItem | null {
  const requirement = normalizeRequirementText(params.requirement);
  if (!requirement) {
    return null;
  }

  const supportingChunkIds = normalizeChunkIds(params.rawSupportingChunkIds, params.allowedChunkIds);
  const value = toStringOrNull(params.rawValue);
  const normalizedValue = value && supportingChunkIds.length > 0 ? value : null;

  return {
    requirement,
    value: normalizedValue,
    supportingChunkIds: normalizedValue ? supportingChunkIds : []
  };
}

function normalizeExtractedList(params: {
  raw: unknown;
  allowedChunkIds: Set<string>;
  topLevelRequirementChunkMap: Map<string, string[]>;
}): { extracted: EvidenceExtractorGateItem[]; hadShapeRepair: boolean } {
  if (Array.isArray(params.raw)) {
    const extracted = params.raw
      .map((entry) => {
        if (!isRecord(entry)) {
          return null;
        }

        const requirement = toStringOrNull(entry.requirement);
        if (!requirement) {
          return null;
        }

        const rawValue = entry.value ?? entry.extractedValue ?? null;
        const requirementKey = normalizeRequirementMatchKey(requirement);
        const mappedChunkIds = params.topLevelRequirementChunkMap.get(requirementKey) ?? [];
        const rawSupportingChunkIds =
          entry.supportingChunkIds ?? entry.chunkIds ?? entry.chunks ?? (mappedChunkIds.length > 0 ? mappedChunkIds : []);

        return normalizeExtractedItem({
          requirement,
          rawValue,
          rawSupportingChunkIds,
          allowedChunkIds: params.allowedChunkIds
        });
      })
      .filter((entry): entry is EvidenceExtractorGateItem => entry !== null)
      .slice(0, EXTRACTOR_LIST_LIMITS.extracted);

    return {
      extracted,
      hadShapeRepair: false
    };
  }

  if (!isRecord(params.raw)) {
    return {
      extracted: [],
      hadShapeRepair: false
    };
  }

  const extracted: EvidenceExtractorGateItem[] = [];
  for (const [rawKey, rawEntry] of Object.entries(params.raw)) {
    const normalizedKeyNoSpace = rawKey.toLowerCase().replace(/[\s_-]+/g, "");
    if (REQUIREMENT_MAP_IGNORED_KEYS.has(normalizedKeyNoSpace)) {
      continue;
    }

    const requirementFromKey = normalizeRequirementText(rawKey);
    if (!requirementFromKey) {
      continue;
    }

    let requirement = requirementFromKey;
    let rawValue: unknown = rawEntry;
    let rawSupportingChunkIds: unknown = [];

    if (isRecord(rawEntry)) {
      requirement = toStringOrNull(rawEntry.requirement) ?? requirementFromKey;
      rawValue = rawEntry.value ?? rawEntry.extractedValue ?? null;
      rawSupportingChunkIds = rawEntry.supportingChunkIds ?? rawEntry.chunkIds ?? rawEntry.chunks ?? [];
    }

    const mappedChunkIds = params.topLevelRequirementChunkMap.get(normalizeRequirementMatchKey(requirement));
    if (
      (rawSupportingChunkIds == null || normalizeChunkIds(rawSupportingChunkIds, params.allowedChunkIds).length === 0) &&
      mappedChunkIds &&
      mappedChunkIds.length > 0
    ) {
      rawSupportingChunkIds = mappedChunkIds;
    }

    const normalized = normalizeExtractedItem({
      requirement,
      rawValue,
      rawSupportingChunkIds,
      allowedChunkIds: params.allowedChunkIds
    });
    if (!normalized) {
      continue;
    }

    extracted.push(normalized);
    if (extracted.length >= EXTRACTOR_LIST_LIMITS.extracted) {
      break;
    }
  }

  return {
    extracted,
    hadShapeRepair: true
  };
}

export function normalizeExtractorOutput(
  raw: unknown,
  allowedChunkIds: Set<string>
): {
  requirements: string[];
  extracted: Array<{ requirement: string; value: string | null; supportingChunkIds: string[] }>;
  overall: "FOUND" | "PARTIAL" | "NOT_FOUND";
  hadShapeRepair: boolean;
  extractorInvalid: boolean;
  invalidReason: "NO_VALID_EXTRACTED_ITEMS" | null;
} {
  const parsed = isRecord(raw) ? raw : {};
  let hadShapeRepair = !isRecord(raw);

  const topLevelChunkCarrier = parsed.supportingChunkIds ?? parsed.chunkIds ?? null;
  const topLevelRequirementChunkMap = extractTopLevelRequirementChunkMap(topLevelChunkCarrier, allowedChunkIds);
  hadShapeRepair = hadShapeRepair || topLevelRequirementChunkMap.hadShapeRepair;

  const requirementList = normalizeRequirementList(parsed.requirements);
  hadShapeRepair = hadShapeRepair || requirementList.hadShapeRepair;

  const extractedList = normalizeExtractedList({
    raw: parsed.extracted,
    allowedChunkIds,
    topLevelRequirementChunkMap: topLevelRequirementChunkMap.map
  });
  hadShapeRepair = hadShapeRepair || extractedList.hadShapeRepair;

  const requirements =
    requirementList.requirements.length > 0
      ? requirementList.requirements
      : dedupeStrings(
          extractedList.extracted
            .map((entry) => entry.requirement)
            .map((entry) => normalizeRequirementText(entry))
            .filter((entry) => entry.length > 0),
          EXTRACTOR_LIST_LIMITS.requirements
        );
  const extracted = extractedList.extracted;
  const validExtracted = extracted.filter((entry) => entry.value !== null && entry.supportingChunkIds.length > 0);
  const extractorInvalid = validExtracted.length === 0;
  const invalidReason: "NO_VALID_EXTRACTED_ITEMS" | null = extractorInvalid ? "NO_VALID_EXTRACTED_ITEMS" : null;
  if (extractorInvalid) {
    hadShapeRepair = true;
  }

  const requirementSet = new Set(requirements.map((requirement) => normalizeRequirementMatchKey(requirement)));
  const satisfiedRequirementSet = new Set(
    validExtracted.map((entry) => normalizeRequirementMatchKey(entry.requirement))
  );
  const allRequirementsSatisfied =
    requirementSet.size > 0
      ? Array.from(requirementSet).every((requirement) => satisfiedRequirementSet.has(requirement))
      : validExtracted.length > 0 && extracted.every((entry) => entry.value !== null);

  const overall: EvidenceExtractorGateOverall = (() => {
    if (extractorInvalid) {
      return "NOT_FOUND";
    }

    if (allRequirementsSatisfied) {
      return "FOUND";
    }

    return "PARTIAL";
  })();

  return {
    requirements,
    extracted,
    overall,
    hadShapeRepair,
    extractorInvalid,
    invalidReason
  };
}

export async function generateEvidenceSufficiency(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<EvidenceSufficiencyModelOutput> {
  const systemPrompt =
    "You are an evidence extractor for document question-answering. " +
    "Use ONLY the provided snippets. Do not guess, infer, or use external knowledge. " +
    "Output JSON only. No prose. No markdown. No code fences. " +
    "Return exactly these keys at top level: requirements, extracted, overall. " +
    "Schema requirement: requirements: string[]. " +
    "Schema requirement: extracted: Array<{ requirement: string, value: string | null, supportingChunkIds: string[] }>. " +
    "Schema requirement: overall: \"FOUND\" | \"PARTIAL\" | \"NOT_FOUND\". " +
    "Do NOT use objects/maps for requirements or extracted. Use arrays only. " +
    "For each extracted item with non-null value, supportingChunkIds must be non-empty and must be chosen ONLY from provided allowedChunkIds. " +
    "If a requirement is not explicitly supported, set value to null and supportingChunkIds to []. " +
    "Minimal valid example: " +
    "{\"requirements\":[\"Requirement A\"],\"extracted\":[{\"requirement\":\"Requirement A\",\"value\":\"Observed value\",\"supportingChunkIds\":[\"chunk-1\"]}],\"overall\":\"FOUND\"}.";

  const userPrompt = `Question:\n${params.question}\n\nallowedChunkIds (CSV): ${toAllowedChunkIdsCsv(params.snippets)}\n\nSnippets:\n${toSnippetText(params.snippets)}`;

  const payload = (await requestOpenAI("/chat/completions", {
    model: OPENAI_CHAT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat completion response did not include content");
  }

  const parsed = JSON.parse(content) as unknown;
  return normalizeExtractorOutput(parsed, new Set(params.snippets.map((snippet) => snippet.chunkId)));
}

export async function generateLegacyEvidenceSufficiency(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<LegacyEvidenceSufficiencyModelOutput> {
  const systemPrompt =
    "You are an evidence sufficiency gate for document question-answering. " +
    "Use ONLY the provided snippets. Do not guess, infer, or use external knowledge. " +
    "Return strict JSON with keys: sufficient, missingPoints, supportingChunkIds. " +
    "sufficient must be true only when the snippets explicitly contain enough information to answer the question. " +
    "missingPoints must be an array of missing required details when sufficient is false. " +
    "supportingChunkIds must only include chunkIds from the snippet list that directly support sufficiency.";

  const userPrompt = `Question:\n${params.question}\n\nSnippets:\n${toSnippetText(params.snippets)}`;

  const payload = (await requestOpenAI("/chat/completions", {
    model: OPENAI_CHAT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat completion response did not include content");
  }

  const parsed = JSON.parse(content) as
    | {
        sufficient?: unknown;
        missingPoints?: unknown;
        supportingChunkIds?: unknown;
      }
    | null;

  const validChunkIds = new Set(params.snippets.map((snippet) => snippet.chunkId));
  const supportingChunkIds = Array.isArray(parsed?.supportingChunkIds)
    ? Array.from(
        new Set(
          parsed.supportingChunkIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0 && validChunkIds.has(value))
        )
      ).slice(0, 5)
    : [];

  const missingPoints = Array.isArray(parsed?.missingPoints)
    ? parsed.missingPoints
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, 12)
    : [];

  const sufficient = parsed?.sufficient === true && supportingChunkIds.length > 0;

  return {
    sufficient,
    missingPoints,
    supportingChunkIds: sufficient ? supportingChunkIds : []
  };
}

export async function generateGroundedAnswer(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<GroundedAnswerModelOutput> {
  const systemPrompt =
    "You are a strict evidence-bounded document QA assistant. " +
    "Use ONLY the provided snippets. Do not infer or add outside facts. " +
    "If snippets do not explicitly support the answer, respond with exactly 'Not found in provided documents.'. " +
    "If some details are missing, use exactly 'Not specified in provided documents.' for those details. " +
    "Return strict JSON with keys: answer, citations, confidence, needsReview. " +
    "citations must be an array of objects with chunkId and quotedSnippet. " +
    "Only cite chunkIds that exist in the snippet list.";

  const userPrompt = `Question:\n${params.question}\n\nSnippets:\n${toSnippetText(params.snippets)}`;

  const payload = (await requestOpenAI("/chat/completions", {
    model: OPENAI_CHAT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat completion response did not include content");
  }

  const parsed = JSON.parse(content) as
    | (Partial<GroundedAnswerModelOutput> & { citationChunkIds?: string[] })
    | null;

  const parsedCitations = Array.isArray(parsed?.citations)
    ? parsed.citations
        .map((value) => {
          if (!value || typeof value !== "object") {
            return null;
          }

          const typed = value as Partial<GroundedAnswerModelCitation>;
          if (typeof typed.chunkId !== "string") {
            return null;
          }

          return {
            chunkId: typed.chunkId,
            quotedSnippet: typeof typed.quotedSnippet === "string" ? typed.quotedSnippet : ""
          };
        })
        .filter((value): value is GroundedAnswerModelCitation => value !== null)
    : [];

  const legacyCitations = Array.isArray(parsed?.citationChunkIds)
    ? parsed.citationChunkIds
        .filter((value): value is string => typeof value === "string")
        .map((chunkId) => ({ chunkId, quotedSnippet: "" }))
    : [];

  const citations = parsedCitations.length > 0 ? parsedCitations : legacyCitations;

  return {
    answer:
      typeof parsed?.answer === "string" ? parsed.answer : "Not found in provided documents.",
    citations: citations.slice(0, 5),
    confidence:
      parsed?.confidence === "high" || parsed?.confidence === "med" || parsed?.confidence === "low"
        ? parsed.confidence
        : "low",
    needsReview: typeof parsed?.needsReview === "boolean" ? parsed.needsReview : true
  };
}
