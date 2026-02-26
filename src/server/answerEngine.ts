import { NOT_SPECIFIED_RESPONSE_TEXT, applyClaimCheckGuardrails } from "@/lib/claimCheck";
import {
  createEmbedding,
  generateEvidenceSufficiency,
  generateGroundedAnswer,
  generateLegacyEvidenceSufficiency,
  type LegacyEvidenceSufficiencyModelOutput,
  type EvidenceSufficiencyModelOutput
} from "@/lib/openai";
import {
  countEmbeddedChunksForOrganization,
  retrieveTopChunks,
  type RetrievedChunk
} from "@/lib/retrieval";
import { sanitizeExtractedText } from "@/lib/textNormalization";

export type Citation = {
  docName: string;
  chunkId: string;
  quotedSnippet: string;
};

export type EvidenceAnswer = {
  answer: string;
  citations: Citation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
  reusedFromApprovedAnswerId?: string;
  reusedFromApprovedMatchType?: "exact" | "near_exact" | "semantic";
  notFoundReason?: NotFoundReason;
  debug?: EvidenceDebugInfo;
};

export type NotFoundReason =
  | "NO_RELEVANT_EVIDENCE"
  | "RETRIEVAL_BELOW_THRESHOLD"
  | "FILTERED_AS_IRRELEVANT";

type ScoredChunk = RetrievedChunk & {
  lexicalOverlapCount: number;
  lexicalScore: number;
  finalScore: number;
};

export type EvidenceDebugChunk = {
  chunkId: string;
  docName: string;
  similarity: number;
  lexicalOverlapCount: number;
  lexicalScore: number;
  finalScore: number;
};

export type EvidenceDebugInfo = {
  threshold: number;
  retrievedTopK: EvidenceDebugChunk[];
  rerankedTopN: EvidenceDebugChunk[];
  chosenChunks: Array<{ chunkId: string; docName: string }>;
  sufficiency: EvidenceSufficiencyModelOutput | null;
  finalCitations: Array<{ chunkId: string; docName: string }>;
  notFoundReason?: NotFoundReason;
};

const TOP_K = 12;
const RERANK_TOP_N = 5;
const MAX_ANSWER_CHUNKS = 5;
const VECTOR_WEIGHT = 0.7;
const LEXICAL_WEIGHT = 0.3;
const MIN_TOP_SIMILARITY = 0.2;
const MIN_TOKEN_LENGTH = 4;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const NORMALIZED_NOT_FOUND_TEXT = normalizeTemplateText(NOT_FOUND_TEXT);
const NORMALIZED_NOT_SPECIFIED_TEXT = normalizeTemplateText(NOT_SPECIFIED_RESPONSE_TEXT);
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const QUESTION_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "among",
  "and",
  "any",
  "are",
  "been",
  "between",
  "both",
  "can",
  "could",
  "describe",
  "details",
  "does",
  "from",
  "have",
  "into",
  "including",
  "information",
  "please",
  "provide",
  "question",
  "should",
  "that",
  "their",
  "them",
  "there",
  "these",
  "those",
  "what",
  "when",
  "where",
  "which",
  "with",
  "within",
  "your"
]);

export const NOT_FOUND_RESPONSE: EvidenceAnswer = {
  answer: NOT_FOUND_TEXT,
  citations: [],
  confidence: "low",
  needsReview: true
};

function createNotFoundResponse(reason: NotFoundReason): EvidenceAnswer {
  return {
    ...NOT_FOUND_RESPONSE,
    notFoundReason: reason
  };
}

function withDebugInfo(answer: EvidenceAnswer, debugEnabled: boolean, debug: EvidenceDebugInfo): EvidenceAnswer {
  if (!debugEnabled) {
    return answer;
  }

  return {
    ...answer,
    debug
  };
}

export function normalizeForMatch(value: string): string {
  return sanitizeExtractedText(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(value: string): string {
  return sanitizeExtractedText(value).replace(/\s+/g, " ").trim();
}

function normalizeTemplateText(value: string): string {
  return sanitizeExtractedText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNotFoundTemplateLike(value: string): boolean {
  const normalized = normalizeTemplateText(value);
  return normalized.includes(NORMALIZED_NOT_FOUND_TEXT);
}

function isNotSpecifiedTemplateLike(value: string): boolean {
  const normalized = normalizeTemplateText(value);
  return normalized.includes(NORMALIZED_NOT_SPECIFIED_TEXT);
}

function parseBooleanFlag(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return null;
}

function isExtractorGateEnabled(): boolean {
  const configured = parseBooleanFlag(process.env.EXTRACTOR_GATE);
  if (configured !== null) {
    return configured;
  }

  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function tokenizeForLexical(value: string): string[] {
  const normalized = normalizeForMatch(value);
  const tokens = normalized.match(/[a-z0-9./-]+/g) ?? [];

  return Array.from(
    new Set(
      tokens.filter((token) => {
        if (token.length < MIN_TOKEN_LENGTH) {
          return false;
        }

        if (QUESTION_STOPWORDS.has(token)) {
          return false;
        }

        return !/^\d+$/.test(token);
      })
    )
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsToken(normalizedText: string, token: string): boolean {
  if (
    token.includes(" ") ||
    token.includes("/") ||
    token.includes(".") ||
    token.includes("-")
  ) {
    return normalizedText.includes(token);
  }

  return new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?:$|\\s)`).test(normalizedText);
}

function scoreLexicalOverlap(content: string, questionTokens: string[]): {
  lexicalOverlapCount: number;
  lexicalScore: number;
} {
  if (questionTokens.length === 0) {
    return {
      lexicalOverlapCount: 0,
      lexicalScore: 0
    };
  }

  const normalizedContent = normalizeForMatch(content);
  let lexicalOverlapCount = 0;

  for (const token of questionTokens) {
    if (containsToken(normalizedContent, token)) {
      lexicalOverlapCount += 1;
    }
  }

  return {
    lexicalOverlapCount,
    lexicalScore: lexicalOverlapCount / questionTokens.length
  };
}

function buildCitationFromChunk(chunk: RetrievedChunk): Citation {
  return {
    docName: chunk.docName,
    chunkId: chunk.chunkId,
    quotedSnippet: normalizeWhitespace(chunk.quotedSnippet)
  };
}

function dedupeCitations(citations: Citation[]): Citation[] {
  return Array.from(new Map(citations.map((citation) => [citation.chunkId, citation])).values());
}

function toDebugChunks(chunks: ScoredChunk[]): EvidenceDebugChunk[] {
  return chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName,
    similarity: chunk.similarity,
    lexicalOverlapCount: chunk.lexicalOverlapCount,
    lexicalScore: chunk.lexicalScore,
    finalScore: chunk.finalScore
  }));
}

function hasModelFormatViolation(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) {
    return true;
  }

  if (/```/.test(trimmed)) {
    return true;
  }

  if (/(^|\n)\s*#{1,6}\s+/.test(trimmed)) {
    return true;
  }

  if (/(^|\n)\s*Snippet\s+\d+/i.test(trimmed)) {
    return true;
  }

  if (/\bchunkId\s*:/i.test(trimmed)) {
    return true;
  }

  if (trimmed.length > 1800 && (trimmed.match(/\n/g) ?? []).length > 12) {
    return true;
  }

  return false;
}

function validateAnswerFormat(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === NOT_FOUND_TEXT || trimmed === NOT_SPECIFIED_RESPONSE_TEXT) {
    return true;
  }

  return !hasModelFormatViolation(trimmed);
}

export function normalizeAnswerOutput(params: {
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  modelHadFormatViolation: boolean;
  citations: Citation[];
  extractorOverall: "FOUND" | "PARTIAL" | "NOT_FOUND";
  allRequirementsSatisfied: boolean;
}): EvidenceAnswer {
  const citations = dedupeCitations(params.citations);
  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const rawAnswer = sanitizeExtractedText(params.modelAnswer).trim();
  if (!rawAnswer || isNotFoundTemplateLike(rawAnswer)) {
    return NOT_FOUND_RESPONSE;
  }

  if (!validateAnswerFormat(rawAnswer)) {
    return NOT_FOUND_RESPONSE;
  }

  const claimCheck = applyClaimCheckGuardrails({
    answer: rawAnswer,
    quotedSnippets: citations.map((citation) => citation.quotedSnippet),
    confidence: params.modelConfidence,
    needsReview: params.modelNeedsReview || params.modelHadFormatViolation
  });

  let answer = sanitizeExtractedText(claimCheck.answer).trim();
  const groundedDraftIsAffirmative =
    !isNotFoundTemplateLike(rawAnswer) && !isNotSpecifiedTemplateLike(rawAnswer);
  const claimCheckRewroteToTemplate =
    isNotFoundTemplateLike(answer) || isNotSpecifiedTemplateLike(answer);

  const preserveGroundedDraftFromClobber =
    params.extractorOverall === "FOUND" &&
    params.allRequirementsSatisfied &&
    groundedDraftIsAffirmative &&
    claimCheckRewroteToTemplate &&
    citations.length > 0;

  if (preserveGroundedDraftFromClobber) {
    answer = rawAnswer;
  }

  if (!answer || isNotFoundTemplateLike(answer)) {
    return NOT_FOUND_RESPONSE;
  }

  if (!validateAnswerFormat(answer)) {
    return NOT_FOUND_RESPONSE;
  }

  const needsReview =
    preserveGroundedDraftFromClobber ||
    claimCheck.needsReview ||
    params.modelHadFormatViolation ||
    isNotSpecifiedTemplateLike(answer);

  let confidence = claimCheck.confidence;
  if (preserveGroundedDraftFromClobber) {
    confidence = "low";
  } else if (isNotSpecifiedTemplateLike(answer)) {
    confidence = "low";
  }

  if (needsReview && confidence === "high") {
    confidence = "med";
  }

  return {
    answer,
    citations,
    confidence,
    needsReview
  };
}

function normalizeRequirementKey(value: string): string {
  return sanitizeExtractedText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function evaluateExtractorGate(params: {
  gate: EvidenceSufficiencyModelOutput;
  validChunkIds: Set<string>;
}): {
  overall: "FOUND" | "PARTIAL" | "NOT_FOUND";
  requirements: string[];
  extracted: EvidenceSufficiencyModelOutput["extracted"];
  supportingChunkIds: string[];
  allRequirementsSatisfied: boolean;
} {
  const extracted = params.gate.extracted
    .map((entry) => {
      const requirement = sanitizeExtractedText(entry.requirement ?? "").trim();
      if (!requirement) {
        return null;
      }

      const supportingChunkIds = Array.from(
        new Set(
          (entry.supportingChunkIds ?? []).filter(
            (chunkId): chunkId is string => typeof chunkId === "string" && params.validChunkIds.has(chunkId)
          )
        )
      ).slice(0, 5);

      const rawValue = typeof entry.value === "string" ? sanitizeExtractedText(entry.value).trim() : null;
      const value = rawValue && supportingChunkIds.length > 0 ? rawValue : null;

      return {
        requirement,
        value,
        supportingChunkIds: value ? supportingChunkIds : []
      };
    })
    .filter((entry): entry is EvidenceSufficiencyModelOutput["extracted"][number] => entry !== null);

  const requirements = (
    params.gate.requirements.length > 0
      ? params.gate.requirements
      : extracted.map((entry) => entry.requirement)
  )
    .map((requirement) => sanitizeExtractedText(requirement).trim())
    .filter((requirement) => requirement.length > 0)
    .slice(0, 12);

  const requirementKeys = Array.from(new Set(requirements.map(normalizeRequirementKey)));
  const satisfiedRequirementKeys = new Set(
    extracted
      .filter((entry) => entry.value !== null && entry.supportingChunkIds.length > 0)
      .map((entry) => normalizeRequirementKey(entry.requirement))
  );

  const someValuesNonNull = extracted.some((entry) => entry.value !== null);
  const allValuesNull = extracted.length === 0 || extracted.every((entry) => entry.value === null);
  const allRequirementsSatisfied =
    requirementKeys.length > 0
      ? requirementKeys.every((key) => satisfiedRequirementKeys.has(key))
      : extracted.length > 0 && extracted.every((entry) => entry.value !== null);

  const parsedOverall = params.gate.overall;
  const overall: "FOUND" | "PARTIAL" | "NOT_FOUND" = (() => {
    if (parsedOverall === "NOT_FOUND" || allValuesNull) {
      return "NOT_FOUND";
    }

    if (someValuesNonNull && !allRequirementsSatisfied) {
      return "PARTIAL";
    }

    if (allRequirementsSatisfied) {
      return "FOUND";
    }

    return "NOT_FOUND";
  })();

  const supportingChunkIds = Array.from(
    new Set(
      extracted
        .filter((entry) => entry.value !== null)
        .flatMap((entry) => entry.supportingChunkIds)
        .filter((chunkId) => params.validChunkIds.has(chunkId))
    )
  );

  return {
    overall,
    requirements,
    extracted,
    supportingChunkIds,
    allRequirementsSatisfied
  };
}

function evaluateLegacyGate(params: {
  question: string;
  gate: LegacyEvidenceSufficiencyModelOutput;
  validChunkIds: Set<string>;
}): {
  overall: "FOUND" | "NOT_FOUND";
  supportingChunkIds: string[];
  allRequirementsSatisfied: boolean;
  debugSufficiency: EvidenceSufficiencyModelOutput;
} {
  const supportingChunkIds = Array.from(
    new Set(
      params.gate.supportingChunkIds.filter(
        (chunkId): chunkId is string => typeof chunkId === "string" && params.validChunkIds.has(chunkId)
      )
    )
  ).slice(0, 5);
  const sufficient = params.gate.sufficient === true && supportingChunkIds.length > 0;

  const fallbackRequirement = sanitizeExtractedText(params.question).trim() || "Question coverage";
  const missingPoints = params.gate.missingPoints
    .map((value) => sanitizeExtractedText(value).trim())
    .filter((value) => value.length > 0)
    .slice(0, 12);

  const requirements = sufficient
    ? [fallbackRequirement]
    : missingPoints.length > 0
      ? missingPoints
      : [fallbackRequirement];
  const extracted = requirements.map((requirement) => ({
    requirement,
    value: sufficient ? "Supported by selected evidence." : null,
    supportingChunkIds: sufficient ? supportingChunkIds : []
  }));
  const overall: "FOUND" | "NOT_FOUND" = sufficient ? "FOUND" : "NOT_FOUND";

  return {
    overall,
    supportingChunkIds: sufficient ? supportingChunkIds : [],
    allRequirementsSatisfied: sufficient,
    debugSufficiency: {
      requirements,
      extracted,
      overall,
      hadShapeRepair: false,
      extractorInvalid: false,
      invalidReason: null
    }
  };
}

function composeFoundAnswerFromExtracted(params: {
  extracted: EvidenceSufficiencyModelOutput["extracted"];
}): string {
  const lines = params.extracted
    .filter((entry) => entry.value !== null)
    .map((entry) => `${entry.requirement}: ${entry.value}`);

  return sanitizeExtractedText(lines.join(" ")).trim();
}

function selectChosenChunks(params: {
  rerankedTopN: ScoredChunk[];
  prioritizedChunkIds: string[];
}): ScoredChunk[] {
  const rerankedById = new Map(params.rerankedTopN.map((chunk) => [chunk.chunkId, chunk]));
  const selectedChunkIds: string[] = [];

  for (const chunkId of params.prioritizedChunkIds) {
    if (!rerankedById.has(chunkId) || selectedChunkIds.includes(chunkId)) {
      continue;
    }

    selectedChunkIds.push(chunkId);
    if (selectedChunkIds.length >= MAX_ANSWER_CHUNKS) {
      break;
    }
  }

  for (const chunk of params.rerankedTopN) {
    if (selectedChunkIds.includes(chunk.chunkId)) {
      continue;
    }

    selectedChunkIds.push(chunk.chunkId);
    if (selectedChunkIds.length >= MAX_ANSWER_CHUNKS) {
      break;
    }
  }

  return selectedChunkIds
    .map((chunkId) => rerankedById.get(chunkId))
    .filter((chunk): chunk is ScoredChunk => Boolean(chunk));
}

function mapModelCitationsToChosenChunks(params: {
  groundedCitations: Array<{ chunkId: string; quotedSnippet: string }>;
  chosenById: Map<string, ScoredChunk>;
}): Citation[] {
  return dedupeCitations(
    params.groundedCitations
      .map((citation) => {
        const chunk = params.chosenById.get(citation.chunkId);
        if (!chunk) {
          return null;
        }

        return {
          docName: chunk.docName,
          chunkId: chunk.chunkId,
          quotedSnippet: normalizeWhitespace(citation.quotedSnippet || chunk.quotedSnippet)
        };
      })
      .filter((citation): citation is Citation => citation !== null)
  );
}

async function generateGroundedFallbackFromReranked(params: {
  question: string;
  rerankedTopN: ScoredChunk[];
  debugEnabled: boolean;
  debugInfo: EvidenceDebugInfo;
  returnNotFound: (reason: NotFoundReason) => EvidenceAnswer;
}): Promise<EvidenceAnswer> {
  if (params.rerankedTopN.length === 0) {
    return params.returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const groundedDraft = await generateGroundedAnswer({
    question: params.question,
    snippets: params.rerankedTopN.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });
  const chosenById = new Map(params.rerankedTopN.map((chunk) => [chunk.chunkId, chunk]));
  const citations = mapModelCitationsToChosenChunks({
    groundedCitations: groundedDraft.citations,
    chosenById
  });
  const answer = sanitizeExtractedText(groundedDraft.answer).trim();

  if (!answer || answer === NOT_FOUND_TEXT || citations.length === 0) {
    return params.returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const fallbackAnswer: EvidenceAnswer = {
    answer,
    citations,
    confidence: "low",
    needsReview: true
  };

  params.debugInfo.chosenChunks = params.rerankedTopN.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName
  }));
  params.debugInfo.finalCitations = fallbackAnswer.citations.map((citation) => ({
    chunkId: citation.chunkId,
    docName: citation.docName
  }));

  return withDebugInfo(fallbackAnswer, params.debugEnabled, params.debugInfo);
}

type GateDecision = {
  mode: "extractor" | "legacy";
  overall: "FOUND" | "PARTIAL" | "NOT_FOUND";
  supportingChunkIds: string[];
  allRequirementsSatisfied: boolean;
  extracted: EvidenceSufficiencyModelOutput["extracted"];
};

function scoreRetrievedChunks(question: string, retrieved: RetrievedChunk[]): ScoredChunk[] {
  const questionTokens = tokenizeForLexical(question);

  return retrieved.map((chunk) => {
    const lexical = scoreLexicalOverlap(`${chunk.quotedSnippet}\n${chunk.fullContent}`, questionTokens);
    const finalScore = VECTOR_WEIGHT * chunk.similarity + LEXICAL_WEIGHT * lexical.lexicalScore;

    return {
      ...chunk,
      lexicalOverlapCount: lexical.lexicalOverlapCount,
      lexicalScore: lexical.lexicalScore,
      finalScore
    };
  });
}

function sortByCombinedScore(chunks: ScoredChunk[]): ScoredChunk[] {
  return [...chunks].sort((left, right) => {
    if (left.finalScore !== right.finalScore) {
      return right.finalScore - left.finalScore;
    }

    if (left.similarity !== right.similarity) {
      return right.similarity - left.similarity;
    }

    if (left.lexicalOverlapCount !== right.lexicalOverlapCount) {
      return right.lexicalOverlapCount - left.lexicalOverlapCount;
    }

    return left.chunkId.localeCompare(right.chunkId);
  });
}

export type AnswerQuestionParams = {
  orgId: string;
  questionText: string;
  debug?: boolean;
  questionnaireId?: string;
  questionId?: string;
};

export async function answerQuestion(params: AnswerQuestionParams): Promise<EvidenceAnswer> {
  const question = params.questionText.trim();
  const debugEnabled = params.debug === true;
  const debugInfo: EvidenceDebugInfo = {
    threshold: MIN_TOP_SIMILARITY,
    retrievedTopK: [],
    rerankedTopN: [],
    chosenChunks: [],
    sufficiency: null,
    finalCitations: []
  };

  const returnNotFound = (reason: NotFoundReason): EvidenceAnswer => {
    debugInfo.notFoundReason = reason;
    return withDebugInfo(createNotFoundResponse(reason), debugEnabled, debugInfo);
  };

  if (!question) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const embeddedChunkCount = await countEmbeddedChunksForOrganization(params.orgId);
  if (embeddedChunkCount === 0) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const questionEmbedding = await createEmbedding(question);
  const retrieved = await retrieveTopChunks({
    organizationId: params.orgId,
    questionEmbedding,
    questionText: question,
    topK: TOP_K
  });

  if (retrieved.length === 0) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const scoredRetrieved = scoreRetrievedChunks(question, retrieved);
  debugInfo.retrievedTopK = toDebugChunks(scoredRetrieved);

  const relevanceFiltered = scoredRetrieved.filter(
    (chunk) => chunk.lexicalOverlapCount > 0 || chunk.similarity >= MIN_TOP_SIMILARITY
  );

  const topSimilarity = scoredRetrieved[0]?.similarity ?? 0;
  if (relevanceFiltered.length === 0) {
    return returnNotFound(
      topSimilarity < MIN_TOP_SIMILARITY ? "RETRIEVAL_BELOW_THRESHOLD" : "FILTERED_AS_IRRELEVANT"
    );
  }

  const rerankedTopN = sortByCombinedScore(relevanceFiltered).slice(0, RERANK_TOP_N);
  debugInfo.rerankedTopN = toDebugChunks(rerankedTopN);

  if (rerankedTopN.length === 0) {
    return returnNotFound(
      topSimilarity < MIN_TOP_SIMILARITY ? "RETRIEVAL_BELOW_THRESHOLD" : "FILTERED_AS_IRRELEVANT"
    );
  }

  const snippets = rerankedTopN.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName,
    quotedSnippet: chunk.quotedSnippet
  }));
  const validChunkIds = new Set(rerankedTopN.map((chunk) => chunk.chunkId));
  let gateDecision: GateDecision;
  const resolveLegacyDecision = async (): Promise<GateDecision> => {
    const legacyGate = await generateLegacyEvidenceSufficiency({
      question,
      snippets
    });
    const legacyDecision = evaluateLegacyGate({
      question,
      gate: legacyGate,
      validChunkIds
    });

    debugInfo.sufficiency = legacyDecision.debugSufficiency;
    return {
      mode: "legacy",
      overall: legacyDecision.overall,
      supportingChunkIds: legacyDecision.supportingChunkIds,
      allRequirementsSatisfied: legacyDecision.allRequirementsSatisfied,
      extracted: []
    };
  };

  if (isExtractorGateEnabled()) {
    const extractorGate = await generateEvidenceSufficiency({
      question,
      snippets
    });
    const extractorDecision = evaluateExtractorGate({
      gate: extractorGate,
      validChunkIds
    });

    debugInfo.sufficiency = {
      ...extractorGate,
      requirements: extractorDecision.requirements,
      extracted: extractorDecision.extracted,
      overall: extractorDecision.overall
    };

    const shouldFallbackToGroundedDraft =
      extractorGate.extractorInvalid &&
      rerankedTopN.length > 0 &&
      (extractorGate.hadShapeRepair === true || extractorGate.invalidReason != null);
    if (shouldFallbackToGroundedDraft) {
      return generateGroundedFallbackFromReranked({
        question,
        rerankedTopN,
        debugEnabled,
        debugInfo,
        returnNotFound
      });
    }

    gateDecision = {
      mode: "extractor",
      overall: extractorDecision.overall,
      supportingChunkIds: extractorDecision.supportingChunkIds,
      allRequirementsSatisfied: extractorDecision.allRequirementsSatisfied,
      extracted: extractorDecision.extracted
    };
  } else {
    gateDecision = await resolveLegacyDecision();
  }

  if (gateDecision.overall === "NOT_FOUND") {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const chosenChunks = selectChosenChunks({
    rerankedTopN,
    prioritizedChunkIds: gateDecision.supportingChunkIds
  });

  debugInfo.chosenChunks = chosenChunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName
  }));

  if (chosenChunks.length === 0) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const chosenById = new Map(chosenChunks.map((chunk) => [chunk.chunkId, chunk]));
  if (gateDecision.mode === "extractor") {
    const citations = dedupeCitations(
      gateDecision.supportingChunkIds
        .map((chunkId) => chosenById.get(chunkId))
        .filter((chunk): chunk is ScoredChunk => Boolean(chunk))
        .map(buildCitationFromChunk)
    );

    if (citations.length === 0) {
      return returnNotFound("FILTERED_AS_IRRELEVANT");
    }

    if (gateDecision.overall === "PARTIAL") {
      const partialAnswer: EvidenceAnswer = {
        answer: NOT_SPECIFIED_RESPONSE_TEXT,
        citations,
        confidence: "low",
        needsReview: true
      };

      debugInfo.finalCitations = partialAnswer.citations.map((citation) => ({
        chunkId: citation.chunkId,
        docName: citation.docName
      }));

      return withDebugInfo(partialAnswer, debugEnabled, debugInfo);
    }

    const extractedDraftAnswer = composeFoundAnswerFromExtracted({
      extracted: gateDecision.extracted
    });
    if (!extractedDraftAnswer) {
      return returnNotFound("NO_RELEVANT_EVIDENCE");
    }

    const normalized = normalizeAnswerOutput({
      modelAnswer: extractedDraftAnswer,
      modelConfidence: "high",
      modelNeedsReview: false,
      modelHadFormatViolation: false,
      citations,
      extractorOverall: gateDecision.overall,
      allRequirementsSatisfied: gateDecision.allRequirementsSatisfied
    });

    if (normalized.answer === NOT_FOUND_TEXT) {
      return returnNotFound("NO_RELEVANT_EVIDENCE");
    }

    debugInfo.finalCitations = normalized.citations.map((citation) => ({
      chunkId: citation.chunkId,
      docName: citation.docName
    }));

    return withDebugInfo(normalized, debugEnabled, debugInfo);
  }

  const grounded = await generateGroundedAnswer({
    question,
    snippets: chosenChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });
  const modelCitations = mapModelCitationsToChosenChunks({
    groundedCitations: grounded.citations,
    chosenById
  });

  if (modelCitations.length === 0) {
    return returnNotFound("FILTERED_AS_IRRELEVANT");
  }

  const extractorOverall = isNotSpecifiedTemplateLike(grounded.answer) ? "PARTIAL" : "FOUND";
  const normalized = normalizeAnswerOutput({
    modelAnswer: grounded.answer,
    modelConfidence: grounded.confidence,
    modelNeedsReview: grounded.needsReview,
    modelHadFormatViolation: hasModelFormatViolation(grounded.answer),
    citations: modelCitations,
    extractorOverall,
    allRequirementsSatisfied: extractorOverall === "FOUND"
  });

  if (normalized.answer === NOT_FOUND_TEXT) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  if (isNotSpecifiedTemplateLike(normalized.answer)) {
    normalized.answer = NOT_SPECIFIED_RESPONSE_TEXT;
  }

  debugInfo.finalCitations = normalized.citations.map((citation) => ({
    chunkId: citation.chunkId,
    docName: citation.docName
  }));

  return withDebugInfo(normalized, debugEnabled, debugInfo);
}
