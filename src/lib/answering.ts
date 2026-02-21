import {
  NOT_SPECIFIED_RESPONSE_TEXT,
  applyClaimCheckGuardrails,
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

type CoverageRule = {
  key: string;
  questionPattern: RegExp;
  evidencePattern: RegExp;
};

type CoverageResult = {
  requestedKeys: string[];
  missingKeys: string[];
  missingInfoInAnswer: boolean;
  needsCoverageReview: boolean;
  vendorSocEvidenceMissing: boolean;
};

type AttemptResult = {
  bestSimilarity: number;
  citations: Citation[];
  fallbackCitations: Citation[];
  answer: string;
  confidence: "low" | "med" | "high";
  needsReview: boolean;
};

const TOP_K = 5;
const RETRY_TOP_K = 10;
const MIN_TOP_SIMILARITY = 0.35;
const MAX_CITATIONS = 3;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const MFA_REQUIRED_FALLBACK =
  "MFA is enabled; whether it is required is not specified in provided documents.";

const COVERAGE_RULES: CoverageRule[] = [
  { key: "algorithm", questionPattern: /\balgorithm\b/i, evidencePattern: /\balgorithm\b|\bcipher\b|\baes\b|\brsa\b/i },
  { key: "cipher", questionPattern: /\bcipher\b/i, evidencePattern: /\bcipher\b|\baes\b|\brsa\b/i },
  { key: "tls", questionPattern: /\btls\b/i, evidencePattern: /\btls\b/i },
  { key: "hsts", questionPattern: /\bhsts\b/i, evidencePattern: /\bhsts\b/i },
  { key: "scope", questionPattern: /\bscope\b/i, evidencePattern: /\bscope\b|at rest|in transit|customer data|all data/i },
  { key: "key", questionPattern: /\bkey\b/i, evidencePattern: /\bkey\b|kms|key management/i },
  { key: "rotation", questionPattern: /\brotation\b/i, evidencePattern: /\brotation\b|rotate/i },
  {
    key: "frequency",
    questionPattern: /\bfrequency\b|how often|daily|weekly|monthly|quarterly|annually/i,
    evidencePattern: /\bfrequency\b|daily|weekly|monthly|quarterly|annually|every\s+\d+/i
  },
  { key: "retention", questionPattern: /\bretention\b|how long|kept for|retain/i, evidencePattern: /\bretention\b|retain|kept for|days|months|years/i },
  { key: "rto", questionPattern: /\brto\b/i, evidencePattern: /\brto\b/i },
  { key: "rpo", questionPattern: /\brpo\b/i, evidencePattern: /\brpo\b/i },
  {
    key: "by_whom",
    questionPattern: /by whom|who\s+(reviews|approves|manages|owns)|who\s+is\s+responsible/i,
    evidencePattern: /owner|responsible|security team|compliance team|managed by|approved by/i
  },
  { key: "third-party", questionPattern: /third[- ]party|vendor/i, evidencePattern: /third[- ]party|vendor/i },
  { key: "soc2", questionPattern: /soc\s*2/i, evidencePattern: /soc\s*2/i },
  { key: "sig", questionPattern: /\bsig\b/i, evidencePattern: /\bsig\b/i },
  { key: "certification", questionPattern: /\bcertification\b/i, evidencePattern: /\bcertification\b|certified/i }
];

export const NOT_FOUND_RESPONSE: EvidenceAnswer = {
  answer: NOT_FOUND_TEXT,
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

function containsNotSpecified(answer: string): boolean {
  return /not specified in provided documents\./i.test(answer);
}

function containsMissingInfoIndicator(answer: string): boolean {
  return /not detailed|not specified/i.test(answer);
}

function appendNotSpecified(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) {
    return NOT_SPECIFIED_RESPONSE_TEXT;
  }

  if (containsNotSpecified(trimmed)) {
    return trimmed;
  }

  const suffix = /[.!?]$/.test(trimmed) ? "" : ".";
  return `${trimmed}${suffix} ${NOT_SPECIFIED_RESPONSE_TEXT}`;
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

function isMfaRequiredSupported(evidenceSnippets: string[]): boolean {
  const evidence = evidenceSnippets.join(" \n ");

  if (/\brequired\b/i.test(evidence)) {
    return true;
  }

  return (
    /(?:\bmfa\b|multi[- ]factor)[\s\S]{0,40}(must|enforced)/i.test(evidence) ||
    /(must|enforced)[\s\S]{0,40}(\bmfa\b|multi[- ]factor)/i.test(evidence)
  );
}

function enforceMfaRequiredClaim(params: {
  question: string;
  answer: string;
  evidenceSnippets: string[];
}): { answer: string; forced: boolean } {
  const mfaContext =
    /\bmfa\b|multi[- ]factor/i.test(params.question) || /\bmfa\b|multi[- ]factor/i.test(params.answer);
  const answerClaimsRequired = /\brequired\b/i.test(params.answer);

  if (!mfaContext || !answerClaimsRequired) {
    return { answer: params.answer, forced: false };
  }

  if (isMfaRequiredSupported(params.evidenceSnippets)) {
    return { answer: params.answer, forced: false };
  }

  return {
    answer: MFA_REQUIRED_FALLBACK,
    forced: true
  };
}

function hasRelevantCitation(question: string, citations: Citation[]): boolean {
  if (citations.length === 0) {
    return false;
  }

  const questionTerms = extractQuestionKeyTerms(question).filter((term) => term.length >= 4);
  if (questionTerms.length === 0) {
    return true;
  }

  const snippetsText = citations.map((citation) => citation.quotedSnippet.toLowerCase()).join(" ");
  return questionTerms.some((term) => snippetsText.includes(term));
}

function evaluateCoverage(question: string, evidenceSnippets: string[], answer: string): CoverageResult {
  const normalizedQuestion = question.toLowerCase();
  const normalizedEvidence = evidenceSnippets.join(" ").toLowerCase();

  const requested = COVERAGE_RULES.filter((rule) => rule.questionPattern.test(normalizedQuestion));
  const missing = requested.filter((rule) => !rule.evidencePattern.test(normalizedEvidence));

  const requestedKeys = requested.map((rule) => rule.key);
  const missingKeys = missing.map((rule) => rule.key);

  const asksVendor = requestedKeys.includes("third-party") || /vendor/i.test(normalizedQuestion);
  const asksSoc2OrSig = requestedKeys.includes("soc2") || requestedKeys.includes("sig");
  const missingSoc2OrSig = missingKeys.includes("soc2") || missingKeys.includes("sig");

  return {
    requestedKeys,
    missingKeys,
    missingInfoInAnswer: containsMissingInfoIndicator(answer),
    needsCoverageReview: requested.length > 0 && (missing.length > 0 || containsMissingInfoIndicator(answer)),
    vendorSocEvidenceMissing: asksVendor && asksSoc2OrSig && missingSoc2OrSig
  };
}

export function normalizeAnswerOutput(params: {
  question: string;
  answer: string;
  citations: Citation[];
  fallbackCitations: Citation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
}): EvidenceAnswer {
  const trimmedAnswer = params.answer.trim();

  if (!trimmedAnswer || trimmedAnswer === NOT_FOUND_TEXT) {
    return NOT_FOUND_RESPONSE;
  }

  const uniqueCitations = dedupeCitations(params.citations).slice(0, MAX_CITATIONS);
  const uniqueFallback = dedupeCitations(params.fallbackCitations).slice(0, MAX_CITATIONS);
  const evidenceSnippets = (uniqueCitations.length > 0 ? uniqueCitations : uniqueFallback).map(
    (citation) => citation.quotedSnippet
  );

  const mfaAdjusted = enforceMfaRequiredClaim({
    question: params.question,
    answer: trimmedAnswer,
    evidenceSnippets
  });

  const claimChecked = applyClaimCheckGuardrails({
    answer: mfaAdjusted.answer,
    quotedSnippets: evidenceSnippets,
    confidence: params.confidence,
    needsReview: params.needsReview
  });

  let finalAnswer = claimChecked.answer;
  let coverage = evaluateCoverage(params.question, evidenceSnippets, finalAnswer);

  if (coverage.missingKeys.length > 0 && !containsNotSpecified(finalAnswer)) {
    finalAnswer = appendNotSpecified(finalAnswer);
    coverage = evaluateCoverage(params.question, evidenceSnippets, finalAnswer);
  }

  const partial = containsNotSpecified(finalAnswer);

  let citations = uniqueCitations;
  if (partial && citations.length === 0) {
    citations = uniqueFallback;
  }

  let needsReview = claimChecked.needsReview || mfaAdjusted.forced || coverage.needsCoverageReview;
  let confidence: "low" | "med" | "high" = claimChecked.confidence;

  if (coverage.needsCoverageReview && confidence === "high") {
    confidence = "med";
  }

  if (coverage.vendorSocEvidenceMissing && confidence === "high") {
    confidence = "med";
  }

  if (partial) {
    needsReview = true;
    if (confidence === "high") {
      confidence = "med";
    }
  }

  // Hard rule: NOT_FOUND always has empty citations.
  if (finalAnswer === NOT_FOUND_TEXT) {
    citations = [];
  }

  // Hard rule: if citations are empty, force low confidence and needs review.
  if (citations.length === 0) {
    needsReview = true;
    confidence = "low";
  }

  return {
    answer: finalAnswer,
    citations,
    confidence,
    needsReview
  };
}

async function runAnswerAttempt(params: {
  organizationId: string;
  question: string;
  questionEmbedding: number[];
  topK: number;
}): Promise<AttemptResult> {
  const retrievedChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: params.topK
  });

  const bestSimilarity = retrievedChunks[0]?.similarity ?? 0;
  const fallbackCitations = retrievedChunks.slice(0, MAX_CITATIONS).map(buildCitationFromChunk);

  if (!hasSufficientEvidence(retrievedChunks)) {
    return {
      bestSimilarity,
      citations: [],
      fallbackCitations,
      answer: NOT_FOUND_TEXT,
      confidence: "low",
      needsReview: true
    };
  }

  const groundedAnswer = await generateGroundedAnswer({
    question: params.question,
    snippets: retrievedChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });

  const citationMap = new Map(retrievedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citations = Array.from(new Set(groundedAnswer.citationChunkIds))
    .slice(0, MAX_CITATIONS)
    .map((chunkId) => citationMap.get(chunkId))
    .filter((value): value is RetrievedChunk => Boolean(value))
    .map(buildCitationFromChunk);

  return {
    bestSimilarity,
    citations,
    fallbackCitations,
    answer: groundedAnswer.answer,
    confidence: groundedAnswer.confidence,
    needsReview: groundedAnswer.needsReview
  };
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

  let attempt = await runAnswerAttempt({
    organizationId: params.organizationId,
    question,
    questionEmbedding,
    topK: TOP_K
  });

  const initialRelevant = hasRelevantCitation(
    question,
    attempt.citations.length > 0 ? attempt.citations : attempt.fallbackCitations
  );

  if (!initialRelevant && attempt.bestSimilarity >= MIN_TOP_SIMILARITY) {
    attempt = await runAnswerAttempt({
      organizationId: params.organizationId,
      question,
      questionEmbedding,
      topK: RETRY_TOP_K
    });
  }

  const finalRelevance = hasRelevantCitation(
    question,
    attempt.citations.length > 0 ? attempt.citations : attempt.fallbackCitations
  );

  if (!finalRelevance) {
    if (attempt.bestSimilarity < MIN_TOP_SIMILARITY) {
      return NOT_FOUND_RESPONSE;
    }

    return NOT_FOUND_RESPONSE;
  }

  return normalizeAnswerOutput({
    question,
    answer: attempt.answer,
    citations: attempt.citations,
    fallbackCitations: attempt.fallbackCitations,
    confidence: attempt.confidence,
    needsReview: attempt.needsReview
  });
}
