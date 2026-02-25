import { NOT_SPECIFIED_RESPONSE_TEXT, applyClaimCheckGuardrails } from "@/lib/claimCheck";
import {
  createEmbedding,
  generateEvidenceSufficiency,
  generateGroundedAnswer,
  type EvidenceSufficiencyModelOutput,
  type GroundedAnswerModelOutput
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
const MAX_ANSWER_CHUNKS = 3;
const VECTOR_WEIGHT = 0.7;
const LEXICAL_WEIGHT = 0.3;
const MIN_TOP_SIMILARITY = 0.2;
const MIN_TOKEN_LENGTH = 4;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const NORMALIZED_NOT_FOUND_TEXT = normalizeTemplateText(NOT_FOUND_TEXT);
const NORMALIZED_NOT_SPECIFIED_TEXT = normalizeTemplateText(NOT_SPECIFIED_RESPONSE_TEXT);

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

async function generateWithFormatEnforcement(params: {
  question: string;
  snippets: Array<{ chunkId: string; docName: string; quotedSnippet: string }>;
}): Promise<{ output: GroundedAnswerModelOutput; hadFormatViolation: boolean }> {
  const first = await generateGroundedAnswer({
    question: params.question,
    snippets: params.snippets
  });

  if (!hasModelFormatViolation(first.answer)) {
    return {
      output: first,
      hadFormatViolation: false
    };
  }

  const strictQuestion =
    "Answer in concise prose only. No markdown headings. No raw snippet dump. " + params.question;

  const second = await generateGroundedAnswer({
    question: strictQuestion,
    snippets: params.snippets
  });

  if (!hasModelFormatViolation(second.answer)) {
    return {
      output: second,
      hadFormatViolation: true
    };
  }

  return {
    output: {
      answer: NOT_FOUND_TEXT,
      citations: [],
      confidence: "low",
      needsReview: true
    },
    hadFormatViolation: true
  };
}

export function normalizeAnswerOutput(params: {
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  modelHadFormatViolation: boolean;
  citations: Citation[];
  sufficiencySufficient: boolean;
  missingPoints: string[];
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
    params.sufficiencySufficient &&
    params.missingPoints.length === 0 &&
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

  const sufficiency = await generateEvidenceSufficiency({
    question,
    snippets: rerankedTopN.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });
  debugInfo.sufficiency = sufficiency;

  if (!sufficiency.sufficient) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const rerankedById = new Map(rerankedTopN.map((chunk) => [chunk.chunkId, chunk]));
  const selectedChunkIds: string[] = [];

  for (const chunkId of sufficiency.bestChunkIds) {
    if (!rerankedById.has(chunkId) || selectedChunkIds.includes(chunkId)) {
      continue;
    }

    selectedChunkIds.push(chunkId);
    if (selectedChunkIds.length >= MAX_ANSWER_CHUNKS) {
      break;
    }
  }

  for (const chunk of rerankedTopN) {
    if (selectedChunkIds.includes(chunk.chunkId)) {
      continue;
    }

    selectedChunkIds.push(chunk.chunkId);
    if (selectedChunkIds.length >= MAX_ANSWER_CHUNKS) {
      break;
    }
  }

  const chosenChunks = selectedChunkIds
    .map((chunkId) => rerankedById.get(chunkId))
    .filter((chunk): chunk is ScoredChunk => Boolean(chunk));

  debugInfo.chosenChunks = chosenChunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName
  }));

  if (chosenChunks.length === 0) {
    return returnNotFound("NO_RELEVANT_EVIDENCE");
  }

  const generation = await generateWithFormatEnforcement({
    question,
    snippets: chosenChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });

  const chosenById = new Map(chosenChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citations = dedupeCitations(
    generation.output.citations
      .map((citation) => chosenById.get(citation.chunkId))
      .filter((chunk): chunk is ScoredChunk => Boolean(chunk))
      .map(buildCitationFromChunk)
  );

  if (citations.length === 0) {
    return returnNotFound("FILTERED_AS_IRRELEVANT");
  }

  const normalized = normalizeAnswerOutput({
    modelAnswer: generation.output.answer,
    modelConfidence: generation.output.confidence,
    modelNeedsReview: generation.output.needsReview,
    modelHadFormatViolation: generation.hadFormatViolation,
    citations,
    sufficiencySufficient: sufficiency.sufficient,
    missingPoints: sufficiency.missingPoints
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
