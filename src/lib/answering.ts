import {
  NOT_SPECIFIED_RESPONSE_TEXT,
  applyClaimCheckGuardrails,
  extractKeyTokens,
  extractQuestionKeyTerms
} from "@/lib/claimCheck";
import { createEmbedding, generateGroundedAnswer } from "@/lib/openai";
import { countEmbeddedChunksForOrganization, retrieveTopChunks, type RetrievedChunk } from "@/lib/retrieval";

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
};

type CoverageResult = {
  requestedCount: number;
  coveredCount: number;
  missingRequested: string[];
  coverageRatio: number;
};

const TOP_K = 5;
const MIN_TOP_SIMILARITY = 0.35;
const MAX_CITATIONS = 3;
const MAX_CITATION_SNIPPET_CHARS = 700;
const MFA_REQUIRED_FALLBACK = "MFA is enabled; requirement is not specified in provided documents.";

const COVERAGE_INTENTS: Array<{
  key: string;
  requestPattern: RegExp;
  evidencePatterns: RegExp[];
}> = [
  {
    key: "algorithm",
    requestPattern: /\balgorithm|cipher|aes|rsa|tls\b/i,
    evidencePatterns: [/\balgorithm\b/i, /\baes[- ]?\d+\b/i, /\brsa\b/i, /\btls\s*\d+(?:\.\d+)?\b/i]
  },
  {
    key: "scope",
    requestPattern: /\bscope\b|which data|what data|applies to|in transit|at rest/i,
    evidencePatterns: [/\bscope\b/i, /at rest/i, /in transit/i, /customer data/i, /all data/i]
  },
  {
    key: "keys",
    requestPattern: /\bkeys?\b|kms|key management|key rotation/i,
    evidencePatterns: [/\bkeys?\b/i, /kms/i, /key management/i, /key rotation/i]
  },
  {
    key: "frequency",
    requestPattern: /\bfrequency\b|how often|periodic|every\s+\d+|daily|weekly|monthly|quarterly|annually/i,
    evidencePatterns: [/daily|weekly|monthly|quarterly|annually|every\s+\d+/i, /frequency/i]
  },
  {
    key: "retention",
    requestPattern: /\bretention\b|retain|how long|kept for/i,
    evidencePatterns: [/retention|retain|kept for|days|months|years/i]
  },
  {
    key: "by_whom",
    requestPattern: /by whom|who\s+(reviews|approves|manages|owns)|owner|responsible/i,
    evidencePatterns: [/owner|responsible|security team|compliance team|lead/i]
  },
  {
    key: "criteria",
    requestPattern: /\bcriteria\b|conditions|when\s+required|threshold/i,
    evidencePatterns: [/criteria|condition|threshold|required when/i]
  },
  {
    key: "soc2",
    requestPattern: /soc\s*2/i,
    evidencePatterns: [/soc\s*2/i]
  },
  {
    key: "sig",
    requestPattern: /\bsig\b/i,
    evidencePatterns: [/\bsig\b/i]
  },
  {
    key: "required",
    requestPattern: /\brequired|mandatory|must|enforced|requirement\b/i,
    evidencePatterns: [/\brequired|mandatory|must|enforced\b/i]
  }
];

export const NOT_FOUND_RESPONSE: EvidenceAnswer = {
  answer: "Not found in provided documents.",
  citations: [],
  confidence: "low",
  needsReview: true
};

function hasSufficientEvidence(chunks: RetrievedChunk[]): boolean {
  if (chunks.length === 0) {
    return false;
  }

  return chunks[0].similarity >= MIN_TOP_SIMILARITY;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function appendNotSpecified(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) {
    return NOT_SPECIFIED_RESPONSE_TEXT;
  }

  if (trimmed.toLowerCase().includes(NOT_SPECIFIED_RESPONSE_TEXT.toLowerCase())) {
    return trimmed;
  }

  const suffix = /[.!?]$/.test(trimmed) ? "" : ".";
  return `${trimmed}${suffix} ${NOT_SPECIFIED_RESPONSE_TEXT}`;
}

function buildCitationSnippet(params: {
  chunk: RetrievedChunk;
  answer: string;
  question: string;
}): string {
  const fullContent = normalizeWhitespace(params.chunk.fullContent);
  const fallbackSnippet = normalizeWhitespace(params.chunk.quotedSnippet);

  if (!fullContent) {
    return fallbackSnippet;
  }

  if (fullContent.length <= MAX_CITATION_SNIPPET_CHARS) {
    return fullContent;
  }

  const anchorTokens = [
    ...extractKeyTokens(params.answer),
    ...extractKeyTokens(params.question)
  ].filter((token) => token.length >= 4);

  const contentLower = fullContent.toLowerCase();
  let anchorIndex = -1;

  for (const token of anchorTokens) {
    const index = contentLower.indexOf(token.toLowerCase());
    if (index >= 0 && (anchorIndex === -1 || index < anchorIndex)) {
      anchorIndex = index;
    }
  }

  const target = MAX_CITATION_SNIPPET_CHARS;
  const startBase = anchorIndex >= 0 ? Math.max(0, anchorIndex - Math.floor(target / 3)) : 0;
  let start = startBase;
  while (start > 0 && /\S/.test(fullContent[start - 1])) {
    start -= 1;
  }

  let end = Math.min(fullContent.length, start + target);
  while (end < fullContent.length && /\S/.test(fullContent[end])) {
    end += 1;
  }

  return fullContent.slice(start, end).trim();
}

function hasRelevantCitation(question: string, citations: Citation[]): boolean {
  if (citations.length === 0) {
    return false;
  }

  const terms = extractQuestionKeyTerms(question).filter((term) => term.length >= 4);
  if (terms.length === 0) {
    return true;
  }

  const snippetText = citations.map((citation) => citation.quotedSnippet.toLowerCase()).join(" ");
  return terms.some((term) => snippetText.includes(term));
}

function enforceMfaRequirementRule(params: {
  question: string;
  answer: string;
  evidenceSnippets: string[];
}): { answer: string; forced: boolean } {
  const asksMfa = /\bmfa\b|multi[- ]factor/i.test(params.question);
  const asksRequired = /\brequired|requirement|mandatory|must|enforced\b/i.test(params.question);

  if (!asksMfa || !asksRequired) {
    return { answer: params.answer, forced: false };
  }

  const evidenceText = params.evidenceSnippets.join(" \n ");
  const hasMfaMention = /\bmfa\b|multi[- ]factor/i.test(evidenceText);
  const hasRequiredNearMfa =
    /(?:\bmfa\b|multi[- ]factor)[^.!?\n]{0,60}(required|mandatory|must|enforced)/i.test(evidenceText) ||
    /(required|mandatory|must|enforced)[^.!?\n]{0,60}(\bmfa\b|multi[- ]factor)/i.test(evidenceText);

  if (hasRequiredNearMfa) {
    return { answer: params.answer, forced: false };
  }

  if (hasMfaMention) {
    return {
      answer: MFA_REQUIRED_FALLBACK,
      forced: true
    };
  }

  return {
    answer: NOT_SPECIFIED_RESPONSE_TEXT,
    forced: true
  };
}

function evaluateCoverage(question: string, evidenceSnippets: string[]): CoverageResult {
  const normalizedQuestion = question.toLowerCase();
  const normalizedEvidence = evidenceSnippets.join(" ").toLowerCase();

  const requested = COVERAGE_INTENTS.filter((intent) => intent.requestPattern.test(normalizedQuestion));
  if (requested.length === 0) {
    return {
      requestedCount: 0,
      coveredCount: 0,
      missingRequested: [],
      coverageRatio: 1
    };
  }

  const covered = requested.filter((intent) =>
    intent.evidencePatterns.some((pattern) => pattern.test(normalizedEvidence))
  );

  const missingRequested = requested
    .filter((intent) => !covered.some((coveredIntent) => coveredIntent.key === intent.key))
    .map((intent) => intent.key);

  return {
    requestedCount: requested.length,
    coveredCount: covered.length,
    missingRequested,
    coverageRatio: covered.length / requested.length
  };
}

function computeConfidence(params: {
  answer: string;
  needsReview: boolean;
  partial: boolean;
  coverage: CoverageResult;
  relevanceFailed: boolean;
  initialConfidence: "low" | "med" | "high";
  hasCitations: boolean;
}): "low" | "med" | "high" {
  if (params.answer === NOT_FOUND_RESPONSE.answer) {
    return "low";
  }

  if (!params.hasCitations && !params.partial) {
    return "low";
  }

  if (params.relevanceFailed) {
    return "low";
  }

  if (params.partial) {
    return "low";
  }

  if (params.needsReview) {
    return params.coverage.coverageRatio >= 0.75 ? "med" : "low";
  }

  if (params.initialConfidence === "high") {
    return "high";
  }

  return "med";
}

export async function answerQuestionWithEvidence(params: {
  organizationId: string;
  question: string;
}): Promise<EvidenceAnswer> {
  const question = params.question.trim();
  if (!question) {
    return NOT_FOUND_RESPONSE;
  }

  const embeddedChunkCount = await countEmbeddedChunksForOrganization(params.organizationId);
  if (embeddedChunkCount === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const questionEmbedding = await createEmbedding(question);
  const retrievedChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding,
    questionText: question,
    topK: TOP_K
  });

  if (!hasSufficientEvidence(retrievedChunks)) {
    return NOT_FOUND_RESPONSE;
  }

  const groundedAnswer = await generateGroundedAnswer({
    question,
    snippets: retrievedChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });

  const citationMap = new Map(retrievedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citationChunkIds = Array.from(new Set(groundedAnswer.citationChunkIds)).slice(0, MAX_CITATIONS);

  const citations = citationChunkIds
    .map((chunkId) => citationMap.get(chunkId))
    .filter((value): value is RetrievedChunk => Boolean(value))
    .map((chunk) => ({
      docName: chunk.docName,
      chunkId: chunk.chunkId,
      quotedSnippet: buildCitationSnippet({
        chunk,
        answer: groundedAnswer.answer,
        question
      })
    }));

  const rawAnswer = groundedAnswer.answer.trim();
  if (!rawAnswer || rawAnswer === NOT_FOUND_RESPONSE.answer || citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const evidenceSnippets = citations.map((citation) => citation.quotedSnippet);
  const mfaAdjusted = enforceMfaRequirementRule({
    question,
    answer: rawAnswer,
    evidenceSnippets
  });

  const guarded = applyClaimCheckGuardrails({
    answer: mfaAdjusted.answer,
    quotedSnippets: evidenceSnippets,
    confidence: groundedAnswer.confidence,
    needsReview: groundedAnswer.needsReview
  });

  let finalAnswer = guarded.answer;
  if (finalAnswer === NOT_FOUND_RESPONSE.answer) {
    return NOT_FOUND_RESPONSE;
  }

  const coverage = evaluateCoverage(question, evidenceSnippets);
  if (coverage.missingRequested.length > 0) {
    finalAnswer = appendNotSpecified(finalAnswer);
  }

  const partial = finalAnswer.toLowerCase().includes(NOT_SPECIFIED_RESPONSE_TEXT.toLowerCase());

  let finalCitations = citations;
  let relevanceFailed = false;

  if (finalAnswer === NOT_FOUND_RESPONSE.answer || partial) {
    finalCitations = [];
  } else if (!hasRelevantCitation(question, citations)) {
    finalCitations = [];
    relevanceFailed = true;
  }

  let needsReview =
    guarded.needsReview ||
    mfaAdjusted.forced ||
    partial ||
    relevanceFailed ||
    coverage.missingRequested.length > 0;

  if (finalCitations.length === 0 && !partial) {
    needsReview = true;
  }

  const confidence = computeConfidence({
    answer: finalAnswer,
    needsReview,
    partial,
    coverage,
    relevanceFailed,
    initialConfidence: guarded.confidence,
    hasCitations: finalCitations.length > 0
  });

  return {
    answer: finalAnswer,
    citations: finalCitations,
    confidence,
    needsReview
  };
}
