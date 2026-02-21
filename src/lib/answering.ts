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
  vendorEvidenceGap: boolean;
};

const TOP_K = 5;
const MIN_TOP_SIMILARITY = 0.35;
const MAX_CITATIONS = 3;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const MFA_REQUIRED_FALLBACK =
  "MFA is enabled; whether it is required is not specified in provided documents.";

const COVERAGE_RULES: CoverageRule[] = [
  {
    key: "algorithm",
    questionPattern: /\balgorithm\b/i,
    evidencePattern: /\balgorithm\b|\bcipher\b|\baes\b|\brsa\b|\bchacha\b/i
  },
  {
    key: "cipher",
    questionPattern: /\bcipher\b/i,
    evidencePattern: /\bcipher\b|\baes\b|\brsa\b|\bchacha\b/i
  },
  {
    key: "tls",
    questionPattern: /\btls\b/i,
    evidencePattern: /\btls\b/i
  },
  {
    key: "hsts",
    questionPattern: /\bhsts\b/i,
    evidencePattern: /\bhsts\b/i
  },
  {
    key: "scope",
    questionPattern: /\bscope\b/i,
    evidencePattern: /\bscope\b|at rest|in transit|customer data|all data/i
  },
  {
    key: "key",
    questionPattern: /\bkey\b/i,
    evidencePattern: /\bkey\b|kms|key management/i
  },
  {
    key: "rotation",
    questionPattern: /\brotation\b/i,
    evidencePattern: /\brotation\b|rotate/i
  },
  {
    key: "frequency",
    questionPattern: /\bfrequency\b|how often|daily|weekly|monthly|quarterly|annually/i,
    evidencePattern: /\bfrequency\b|daily|weekly|monthly|quarterly|annually|every\s+\d+/i
  },
  {
    key: "retention",
    questionPattern: /\bretention\b|how long|kept for|retain/i,
    evidencePattern: /\bretention\b|retain|kept for|days|months|years/i
  },
  {
    key: "rto",
    questionPattern: /\brto\b/i,
    evidencePattern: /\brto\b/i
  },
  {
    key: "rpo",
    questionPattern: /\brpo\b/i,
    evidencePattern: /\brpo\b/i
  },
  {
    key: "by_whom",
    questionPattern: /by whom|who\s+(reviews|approves|manages|owns)|who\s+is\s+responsible/i,
    evidencePattern: /owner|responsible|security team|compliance team|managed by|approved by/i
  },
  {
    key: "third-party",
    questionPattern: /third[- ]party|vendor/i,
    evidencePattern: /third[- ]party|vendor/i
  },
  {
    key: "soc2",
    questionPattern: /soc\s*2/i,
    evidencePattern: /soc\s*2/i
  },
  {
    key: "sig",
    questionPattern: /\bsig\b/i,
    evidencePattern: /\bsig\b/i
  },
  {
    key: "certification",
    questionPattern: /\bcertification\b/i,
    evidencePattern: /\bcertification\b|certified/i
  }
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

function isMfaRequiredSupported(evidenceSnippets: string[]): boolean {
  const evidence = evidenceSnippets.join(" \n ");

  if (/\brequired\b/i.test(evidence)) {
    return true;
  }

  const nearbyRule =
    /(?:\bmfa\b|multi[- ]factor)[\s\S]{0,40}(must|enforced)/i.test(evidence) ||
    /(must|enforced)[\s\S]{0,40}(\bmfa\b|multi[- ]factor)/i.test(evidence);

  return nearbyRule;
}

function enforceMfaRequiredClaim(params: {
  question: string;
  answer: string;
  evidenceSnippets: string[];
}): { answer: string; forced: boolean } {
  const mfaContext = /\bmfa\b|multi[- ]factor/i.test(params.question) || /\bmfa\b|multi[- ]factor/i.test(params.answer);
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
  const missingInfoInAnswer = containsMissingInfoIndicator(answer);
  const needsCoverageReview = requested.length > 0 && (missingInfoInAnswer || missing.length > 0);

  const asksSoc2 = requestedKeys.includes("soc2");
  const asksSig = requestedKeys.includes("sig");
  const missingSoc2 = missingKeys.includes("soc2");
  const missingSig = missingKeys.includes("sig");

  return {
    requestedKeys,
    missingKeys,
    missingInfoInAnswer,
    needsCoverageReview,
    vendorEvidenceGap: (asksSoc2 && missingSoc2) || (asksSig && missingSig)
  };
}

export function normalizeAnswerOutput(params: {
  question: string;
  answer: string;
  citations: Citation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
}): EvidenceAnswer {
  const trimmedAnswer = params.answer.trim();
  if (!trimmedAnswer || trimmedAnswer === NOT_FOUND_TEXT) {
    return NOT_FOUND_RESPONSE;
  }

  const uniqueCitations = Array.from(
    new Map(
      params.citations.slice(0, MAX_CITATIONS).map((citation) => [
        citation.chunkId,
        {
          docName: citation.docName,
          chunkId: citation.chunkId,
          quotedSnippet: normalizeWhitespace(citation.quotedSnippet)
        }
      ])
    ).values()
  );

  const evidenceSnippets = uniqueCitations.map((citation) => citation.quotedSnippet);

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

  let citations = uniqueCitations;
  let relevanceFailed = false;

  if (finalAnswer === NOT_FOUND_TEXT || containsNotSpecified(finalAnswer)) {
    citations = [];
  } else if (!hasRelevantCitation(params.question, citations)) {
    citations = [];
    relevanceFailed = true;
  }

  let needsReview =
    claimChecked.needsReview ||
    mfaAdjusted.forced ||
    relevanceFailed ||
    coverage.needsCoverageReview;

  let confidence: "low" | "med" | "high" = claimChecked.confidence;

  if (coverage.needsCoverageReview && confidence === "high") {
    confidence = "med";
  }

  if (coverage.vendorEvidenceGap && confidence === "high") {
    confidence = "med";
  }

  if (containsNotSpecified(finalAnswer) || finalAnswer === NOT_FOUND_TEXT) {
    needsReview = true;
    confidence = "low";
  }

  // Hard rule: no citations means always low confidence and needs review.
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
      quotedSnippet: normalizeWhitespace(chunk.quotedSnippet)
    }));

  return normalizeAnswerOutput({
    question,
    answer: groundedAnswer.answer,
    citations,
    confidence: groundedAnswer.confidence,
    needsReview: groundedAnswer.needsReview
  });
}
