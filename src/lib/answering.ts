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

type AskDefinition = {
  id: string;
  label: string;
  questionPatterns: RegExp[];
  evidencePatterns: RegExp[];
};

type AskCoverage = {
  asks: AskDefinition[];
  coveredAsks: AskDefinition[];
  missingAsks: AskDefinition[];
};

type AttemptResult = {
  bestSimilarity: number;
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  citationsFromModel: Citation[];
  fallbackCitations: Citation[];
};

const TOP_K = 5;
const RETRY_TOP_K = 10;
const MIN_TOP_SIMILARITY = 0.35;
const MAX_CITATIONS = 2;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const PARTIAL_TEMPLATE_HEADER = "Confirmed from provided documents:";
const PARTIAL_TEMPLATE_MISSING = "Not specified in provided documents:";
const MFA_REQUIRED_FALLBACK =
  "MFA is enabled; whether it is required is not specified in provided documents.";

const ASK_DEFINITIONS: AskDefinition[] = [
  {
    id: "backup_frequency",
    label: "backup frequency",
    questionPatterns: [/\bbackup\b|\bbackups\b|disaster recovery|\bdr\b/i],
    evidencePatterns: [
      /(?:\bbackup\b|\bbackups\b)[^.!?\n]{0,60}(daily|weekly|monthly|quarterly|annually|hourly|every\s+\d+)/i,
      /(daily|weekly|monthly|quarterly|annually|hourly|every\s+\d+)[^.!?\n]{0,60}(?:\bbackup\b|\bbackups\b)/i
    ]
  },
  {
    id: "dr_testing",
    label: "disaster recovery testing frequency",
    questionPatterns: [/disaster recovery|\bdr\b|restore testing|recovery testing|dr testing/i],
    evidencePatterns: [/(disaster recovery|\bdr\b|recovery)[^.!?\n]{0,80}(tested|testing|exercise|annually|quarterly|monthly|weekly|daily|every)/i]
  },
  {
    id: "rto",
    label: "RTO",
    questionPatterns: [/\brto\b|recovery time objective/i],
    evidencePatterns: [/\brto\b[^.!?\n]{0,30}(\d+|hours?|hrs?|days?)/i]
  },
  {
    id: "rpo",
    label: "RPO",
    questionPatterns: [/\brpo\b|recovery point objective/i],
    evidencePatterns: [/\brpo\b[^.!?\n]{0,30}(\d+|hours?|hrs?|days?)/i]
  },
  {
    id: "retention",
    label: "retention period",
    questionPatterns: [/\bretention\b|retain|kept for|how long/i],
    evidencePatterns: [/\bretention\b|retain|kept for|days|months|years/i]
  },
  {
    id: "restore_testing_cadence",
    label: "restore testing cadence",
    questionPatterns: [/restore testing|restore test|restore cadence|restore frequency/i],
    evidencePatterns: [/restore[^.!?\n]{0,60}(testing|test|cadence|frequency|annually|quarterly|monthly|weekly|daily)/i]
  },
  {
    id: "severity_levels",
    label: "severity levels",
    questionPatterns: [/severity levels?|severities|sev-\d/i],
    evidencePatterns: [/severity levels?|sev-\d/i]
  },
  {
    id: "triage",
    label: "triage",
    questionPatterns: [/triage/i],
    evidencePatterns: [/triage/i]
  },
  {
    id: "mitigation",
    label: "mitigation",
    questionPatterns: [/mitigation/i],
    evidencePatterns: [/mitigation/i]
  },
  {
    id: "containment",
    label: "containment",
    questionPatterns: [/containment/i],
    evidencePatterns: [/containment/i]
  },
  {
    id: "eradication",
    label: "eradication",
    questionPatterns: [/eradication/i],
    evidencePatterns: [/eradication/i]
  },
  {
    id: "recovery",
    label: "recovery",
    questionPatterns: [/\brecovery\b/i],
    evidencePatterns: [/\brecovery\b/i]
  },
  {
    id: "timelines",
    label: "response timelines",
    questionPatterns: [/timeline|sla|within\s+\d+|response time/i],
    evidencePatterns: [/timeline|within\s+\d+|hours?|days?|sla/i]
  },
  {
    id: "algorithm",
    label: "encryption algorithm",
    questionPatterns: [/algorithm|cipher|aes|rsa/i],
    evidencePatterns: [/algorithm|cipher|aes|rsa/i]
  },
  {
    id: "tls",
    label: "TLS version",
    questionPatterns: [/\btls\b/i],
    evidencePatterns: [/\btls\b\s*\d+(?:\.\d+)?/i]
  },
  {
    id: "hsts",
    label: "HSTS configuration",
    questionPatterns: [/\bhsts\b/i],
    evidencePatterns: [/\bhsts\b/i]
  },
  {
    id: "scope",
    label: "scope",
    questionPatterns: [/\bscope\b|which systems|which data|applies to/i],
    evidencePatterns: [/scope|at rest|in transit|customer data|production/i]
  },
  {
    id: "keys",
    label: "key management",
    questionPatterns: [/\bkeys?\b|kms|key management/i],
    evidencePatterns: [/\bkeys?\b|kms|key management|rotation/i]
  },
  {
    id: "frequency",
    label: "frequency",
    questionPatterns: [/\bfrequency\b|how often|daily|weekly|monthly|quarterly|annually/i],
    evidencePatterns: [/daily|weekly|monthly|quarterly|annually|every\s+\d+/i]
  },
  {
    id: "retention_generic",
    label: "retention",
    questionPatterns: [/\bretention\b/i],
    evidencePatterns: [/retention|retain|kept for|days|months|years/i]
  },
  {
    id: "by_whom",
    label: "ownership by role/team",
    questionPatterns: [/by whom|who\s+(approves|reviews|manages|owns)|responsible/i],
    evidencePatterns: [/owner|responsible|managed by|security team|compliance team/i]
  },
  {
    id: "third_party",
    label: "third-party/vendor details",
    questionPatterns: [/third[- ]party|vendor/i],
    evidencePatterns: [/third[- ]party|vendor/i]
  },
  {
    id: "soc2",
    label: "SOC2 evidence",
    questionPatterns: [/soc\s*2/i],
    evidencePatterns: [/soc\s*2/i]
  },
  {
    id: "sig",
    label: "SIG evidence",
    questionPatterns: [/\bsig\b/i],
    evidencePatterns: [/\bsig\b/i]
  },
  {
    id: "certification",
    label: "certification details",
    questionPatterns: [/certification|certified/i],
    evidencePatterns: [/certification|certified|iso\s*27001/i]
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

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
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

function extractAsksFromParentheses(question: string): AskDefinition[] {
  const matches = Array.from(question.matchAll(/\(([^)]+)\)/g));
  if (matches.length === 0) {
    return [];
  }

  const bucket = matches.map((match) => match[1].toLowerCase()).join(" ");

  return ASK_DEFINITIONS.filter((ask) => ask.questionPatterns.some((pattern) => pattern.test(bucket)));
}

function extractAsks(question: string): AskDefinition[] {
  const byQuestion = ASK_DEFINITIONS.filter((ask) =>
    ask.questionPatterns.some((pattern) => pattern.test(question))
  );

  const byParentheses = extractAsksFromParentheses(question);
  return Array.from(new Map([...byQuestion, ...byParentheses].map((ask) => [ask.id, ask])).values());
}

function evaluateAsksCoverage(question: string, citations: Citation[]): AskCoverage {
  const asks = extractAsks(question);
  if (asks.length === 0) {
    return {
      asks: [],
      coveredAsks: [],
      missingAsks: []
    };
  }

  const snippets = citations.map((citation) => citation.quotedSnippet).join(" \n ");

  const coveredAsks = asks.filter((ask) =>
    ask.evidencePatterns.some((pattern) => pattern.test(snippets))
  );

  const missingAsks = asks.filter(
    (ask) => !coveredAsks.some((coveredAsk) => coveredAsk.id === ask.id)
  );

  return {
    asks,
    coveredAsks,
    missingAsks
  };
}

function extractConfirmedFacts(coveredAsks: AskDefinition[], citations: Citation[]): string[] {
  const facts: string[] = [];

  for (const ask of coveredAsks) {
    for (const citation of citations) {
      const sentences = splitSentences(citation.quotedSnippet);
      const match = sentences.find((sentence) =>
        ask.evidencePatterns.some((pattern) => pattern.test(sentence))
      );

      if (match) {
        facts.push(match);
        break;
      }
    }
  }

  return Array.from(new Set(facts)).slice(0, 5);
}

function formatPartialAnswer(confirmedFacts: string[], missingLabels: string[]): string {
  const confirmedBlock = confirmedFacts.map((fact) => `- ${fact}`).join("\n");
  const missingBlock = missingLabels.map((label) => `- ${label}`).join("\n");

  return `${PARTIAL_TEMPLATE_HEADER}\n${confirmedBlock}\n${PARTIAL_TEMPLATE_MISSING}\n${missingBlock}`;
}

function buildFullAnswer(confirmedFacts: string[]): string {
  if (confirmedFacts.length === 0) {
    return NOT_SPECIFIED_RESPONSE_TEXT;
  }

  if (confirmedFacts.length === 1) {
    return confirmedFacts[0];
  }

  return confirmedFacts.join(" ");
}

function isMfaRequiredSupported(citations: Citation[]): boolean {
  const evidence = citations.map((citation) => citation.quotedSnippet).join(" \n ");

  if (/\brequired\b/i.test(evidence)) {
    return true;
  }

  return (
    /(?:\bmfa\b|multi[- ]factor)[\s\S]{0,40}(must|enforced)/i.test(evidence) ||
    /(must|enforced)[\s\S]{0,40}(\bmfa\b|multi[- ]factor)/i.test(evidence)
  );
}

function enforceMfaRequiredClaim(question: string, answer: string, citations: Citation[]): string {
  const mfaContext = /\bmfa\b|multi[- ]factor/i.test(question) || /\bmfa\b|multi[- ]factor/i.test(answer);
  const claimsRequired = /\brequired\b/i.test(answer);

  if (!mfaContext || !claimsRequired) {
    return answer;
  }

  if (isMfaRequiredSupported(citations)) {
    return answer;
  }

  return MFA_REQUIRED_FALLBACK;
}

function isCitationRelevant(question: string, citation: Citation): boolean {
  const keyTerms = extractQuestionKeyTerms(question).filter((term) => term.length >= 4);
  if (keyTerms.length === 0) {
    return true;
  }

  const snippet = citation.quotedSnippet.toLowerCase();
  return keyTerms.some((term) => snippet.includes(term));
}

function selectRelevantCitations(question: string, citations: Citation[]): Citation[] {
  const relevant = citations.filter((citation) => isCitationRelevant(question, citation));
  return relevant.slice(0, MAX_CITATIONS);
}

function shouldCapConfidenceToMed(question: string, missingAsks: AskDefinition[]): boolean {
  if (missingAsks.length === 0) {
    return false;
  }

  const asksSoc2OrSig = /soc\s*2|\bsig\b/i.test(question);
  const missingSoc2OrSig = missingAsks.some((ask) => ask.id === "soc2" || ask.id === "sig");

  return asksSoc2OrSig && missingSoc2OrSig;
}

export function normalizeAnswerOutput(params: {
  question: string;
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  citations: Citation[];
}): EvidenceAnswer {
  const citations = dedupeCitations(params.citations);

  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const coverage = evaluateAsksCoverage(params.question, citations);
  const confirmedFacts = extractConfirmedFacts(coverage.coveredAsks, citations);
  const missingLabels = coverage.missingAsks.map((ask) => ask.label);

  const modelClaimCheck = applyClaimCheckGuardrails({
    answer: params.modelAnswer,
    quotedSnippets: citations.map((citation) => citation.quotedSnippet),
    confidence: params.modelConfidence,
    needsReview: params.modelNeedsReview
  });

  const modelHadUnsupportedClaims =
    !containsNotSpecified(params.modelAnswer) && containsNotSpecified(modelClaimCheck.answer);

  let answer: string;
  let outcome: "FULL" | "PARTIAL";

  if (missingLabels.length > 0) {
    if (confirmedFacts.length > 0) {
      answer = formatPartialAnswer(confirmedFacts, missingLabels);
      outcome = "PARTIAL";
    } else {
      answer = NOT_SPECIFIED_RESPONSE_TEXT;
      outcome = "PARTIAL";
    }
  } else {
    answer = buildFullAnswer(confirmedFacts);
    outcome = "FULL";
  }

  answer = enforceMfaRequiredClaim(params.question, answer, citations);

  if (answer === NOT_FOUND_TEXT) {
    return NOT_FOUND_RESPONSE;
  }

  let needsReview =
    outcome === "PARTIAL" ||
    params.modelNeedsReview ||
    modelHadUnsupportedClaims ||
    containsNotSpecified(answer);

  let confidence: "low" | "med" | "high";

  if (outcome === "PARTIAL") {
    confidence = "low";
  } else {
    confidence = params.modelConfidence === "high" ? "high" : "med";
    if (needsReview) {
      confidence = "low";
    }
  }

  if (shouldCapConfidenceToMed(params.question, coverage.missingAsks) && confidence === "high") {
    confidence = "med";
  }

  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  return {
    answer,
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
  const fallbackCitations = retrievedChunks.slice(0, MAX_CITATIONS + 1).map(buildCitationFromChunk);

  if (!hasSufficientEvidence(retrievedChunks)) {
    return {
      bestSimilarity,
      modelAnswer: NOT_FOUND_TEXT,
      modelConfidence: "low",
      modelNeedsReview: true,
      citationsFromModel: [],
      fallbackCitations
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

  const chunkById = new Map(retrievedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citationsFromModel = Array.from(new Set(groundedAnswer.citationChunkIds))
    .map((chunkId) => chunkById.get(chunkId))
    .filter((value): value is RetrievedChunk => Boolean(value))
    .map(buildCitationFromChunk);

  return {
    bestSimilarity,
    modelAnswer: groundedAnswer.answer,
    modelConfidence: groundedAnswer.confidence,
    modelNeedsReview: groundedAnswer.needsReview,
    citationsFromModel,
    fallbackCitations
  };
}

function selectCitationsForNormalization(question: string, attempt: AttemptResult): Citation[] {
  const merged = dedupeCitations([...attempt.citationsFromModel, ...attempt.fallbackCitations]);
  return selectRelevantCitations(question, merged);
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

  if (attempt.bestSimilarity < MIN_TOP_SIMILARITY) {
    return NOT_FOUND_RESPONSE;
  }

  let citations = selectCitationsForNormalization(question, attempt);

  if (citations.length === 0 && attempt.bestSimilarity >= MIN_TOP_SIMILARITY) {
    attempt = await runAnswerAttempt({
      organizationId: params.organizationId,
      question,
      questionEmbedding,
      topK: RETRY_TOP_K
    });

    if (attempt.bestSimilarity < MIN_TOP_SIMILARITY) {
      return NOT_FOUND_RESPONSE;
    }

    citations = selectCitationsForNormalization(question, attempt);
  }

  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  return normalizeAnswerOutput({
    question,
    modelAnswer: attempt.modelAnswer,
    modelConfidence: attempt.modelConfidence,
    modelNeedsReview: attempt.modelNeedsReview,
    citations
  });
}
