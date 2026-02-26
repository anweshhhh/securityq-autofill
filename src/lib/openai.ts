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

export async function generateEvidenceSufficiency(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<EvidenceSufficiencyModelOutput> {
  const systemPrompt =
    "You are an evidence extractor for document question-answering. " +
    "Use ONLY the provided snippets. Do not guess, infer, or use external knowledge. " +
    "First list atomic answer requirements from the question. " +
    "Then extract a value for each requirement. If a requirement is not explicitly present, set value to null. " +
    "For every non-null value, include supportingChunkIds that directly support it (must be chunkIds from snippet list). " +
    "Return strict JSON with keys: requirements, extracted, overall. " +
    "overall must be one of FOUND, PARTIAL, NOT_FOUND.";

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
        requirements?: unknown;
        extracted?: unknown;
        overall?: unknown;
      }
    | null;

  const validChunkIds = new Set(params.snippets.map((snippet) => snippet.chunkId));
  const requirements = Array.isArray(parsed?.requirements)
    ? parsed.requirements
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, 12)
    : [];

  const extracted = Array.isArray(parsed?.extracted)
    ? parsed.extracted
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }

          const typed = entry as {
            requirement?: unknown;
            value?: unknown;
            supportingChunkIds?: unknown;
          };

          const requirement = typeof typed.requirement === "string" ? typed.requirement.trim() : "";
          if (!requirement) {
            return null;
          }

          const supportingChunkIdsRaw = Array.isArray(typed.supportingChunkIds)
            ? typed.supportingChunkIds
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter((value) => value.length > 0 && validChunkIds.has(value))
            : [];
          const supportingChunkIds = Array.from(new Set(supportingChunkIdsRaw)).slice(0, 5);

          const rawValue = typeof typed.value === "string" ? typed.value.trim() : null;
          const value = rawValue && supportingChunkIds.length > 0 ? rawValue : null;

          return {
            requirement,
            value,
            supportingChunkIds: value ? supportingChunkIds : []
          } satisfies EvidenceExtractorGateItem;
        })
        .filter((entry): entry is EvidenceExtractorGateItem => entry !== null)
        .slice(0, 16)
    : [];

  const normalizedRequirements =
    requirements.length > 0
      ? requirements
      : Array.from(new Set(extracted.map((entry) => entry.requirement).filter((value) => value.length > 0))).slice(
          0,
          12
        );

  const requirementSet = new Set(
    normalizedRequirements.map((requirement) => requirement.toLowerCase().replace(/\s+/g, " ").trim())
  );
  const satisfiedRequirements = new Set(
    extracted
      .filter((entry) => entry.value !== null && entry.supportingChunkIds.length > 0)
      .map((entry) => entry.requirement.toLowerCase().replace(/\s+/g, " ").trim())
  );

  const allValuesNull = extracted.length === 0 || extracted.every((entry) => entry.value === null);
  const someValuesNonNull = extracted.some((entry) => entry.value !== null);
  const allRequirementsSatisfied =
    requirementSet.size > 0
      ? Array.from(requirementSet).every((requirement) => satisfiedRequirements.has(requirement))
      : extracted.length > 0 && extracted.every((entry) => entry.value !== null);

  const parsedOverall =
    parsed?.overall === "FOUND" || parsed?.overall === "PARTIAL" || parsed?.overall === "NOT_FOUND"
      ? parsed.overall
      : null;
  const overall: EvidenceExtractorGateOverall = (() => {
    if (parsedOverall === "NOT_FOUND" || allValuesNull) {
      return "NOT_FOUND";
    }

    if (allRequirementsSatisfied) {
      return "FOUND";
    }

    if (someValuesNonNull) {
      return "PARTIAL";
    }

    return "NOT_FOUND";
  })();

  return {
    requirements: normalizedRequirements,
    extracted,
    overall
  };
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
