import {
  NOT_SPECIFIED_RESPONSE_TEXT,
  applyClaimCheckGuardrails,
  extractQuestionKeyTerms
} from "@/lib/claimCheck";
import {
  createEmbedding,
  generateGroundedAnswer,
  type GroundedAnswerModelOutput
} from "@/lib/openai";
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

type ScoredChunk = RetrievedChunk & {
  overlapScore: number;
  strongOverlapScore: number;
};

type AttemptResult = {
  bestSimilarity: number;
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  modelHadFormatViolation: boolean;
  citationsFromModel: Citation[];
  fallbackCitations: Citation[];
  scoredChunks: ScoredChunk[];
};

const TOP_K = 5;
const RETRY_TOP_K = 10;
const MAX_ANSWER_CHUNKS = 3;
const MAX_CITATIONS = 2;
const MIN_TOP_SIMILARITY = 0.35;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const PARTIAL_TEMPLATE_HEADER = "Confirmed from provided documents:";
const PARTIAL_TEMPLATE_MISSING = "Not specified in provided documents:";
const MFA_REQUIRED_FALLBACK =
  "MFA is enabled; whether it is required is not specified in provided documents.";

const QUESTION_KEY_PHRASES = [
  "pen test",
  "penetration",
  "backup",
  "dr",
  "rto",
  "rpo",
  "restore",
  "retention",
  "sdlc",
  "code review",
  "ci/cd",
  "branch",
  "tls",
  "hsts",
  "mfa",
  "vendor",
  "subprocessor",
  "deletion",
  "dsr"
];

const QUESTION_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "any",
  "are",
  "been",
  "between",
  "both",
  "does",
  "from",
  "have",
  "into",
  "including",
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
  "your",
  "tests",
  "test",
  "testing"
]);

const WEAK_QUESTION_KEYWORDS = new Set([
  "about",
  "across",
  "after",
  "answer",
  "answers",
  "around",
  "available",
  "based",
  "before",
  "controls",
  "control",
  "describe",
  "details",
  "document",
  "documents",
  "evidence",
  "explain",
  "follow",
  "following",
  "generally",
  "include",
  "information",
  "often",
  "performed",
  "perform",
  "please",
  "policy",
  "process",
  "provide",
  "question",
  "questions",
  "security",
  "should",
  "show",
  "state",
  "status",
  "using",
  "whether"
]);

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
    evidencePatterns: [
      /(disaster recovery|\bdr\b|recovery)[^.!?\n]{0,80}(tested|testing|exercise|annually|quarterly|monthly|weekly|daily|every)/i
    ]
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
    evidencePatterns: [/restore[^.!?\n]{0,80}(testing|test|cadence|frequency|annually|quarterly|monthly|weekly|daily)/i]
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

function extractQuestionKeywords(question: string): string[] {
  const normalizedQuestion = question.toLowerCase();
  const keywords = new Set<string>();

  for (const token of normalizedQuestion.match(/[a-z0-9/-]+/g) ?? []) {
    if (token.length < 4) {
      continue;
    }

    if (QUESTION_STOPWORDS.has(token)) {
      continue;
    }

    keywords.add(token);
  }

  for (const phrase of QUESTION_KEY_PHRASES) {
    if (normalizedQuestion.includes(phrase)) {
      keywords.add(phrase);
    }
  }

  return Array.from(keywords);
}

function extractStrongQuestionKeywords(questionKeywords: string[]): string[] {
  return questionKeywords.filter((keyword) => !WEAK_QUESTION_KEYWORDS.has(keyword));
}

function scoreChunkOverlap(chunkText: string, questionKeywords: string[]): number {
  const normalizedChunk = chunkText.toLowerCase();
  let score = 0;

  for (const keyword of questionKeywords) {
    if (normalizedChunk.includes(keyword)) {
      score += 1;
    }
  }

  return score;
}

function filterAndRerankChunks(question: string, chunks: RetrievedChunk[]): ScoredChunk[] {
  const questionKeywords = extractQuestionKeywords(question);
  const strongKeywords = extractStrongQuestionKeywords(questionKeywords);
  const questionWordCount = question.trim().split(/\s+/).filter(Boolean).length;
  const minOverlap = questionWordCount >= 14 || questionKeywords.length >= 8 ? 2 : 1;

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      overlapScore: scoreChunkOverlap(chunk.quotedSnippet + "\n" + chunk.fullContent, questionKeywords),
      strongOverlapScore: scoreChunkOverlap(
        chunk.quotedSnippet + "\n" + chunk.fullContent,
        strongKeywords
      )
    }))
    .filter((chunk) => {
      if (chunk.overlapScore < minOverlap) {
        return false;
      }

      if (strongKeywords.length === 0) {
        return true;
      }

      return chunk.strongOverlapScore >= 1;
    });

  scored.sort((left, right) => {
    if (left.overlapScore !== right.overlapScore) {
      return right.overlapScore - left.overlapScore;
    }

    if (left.similarity !== right.similarity) {
      return right.similarity - left.similarity;
    }

    return left.chunkId.localeCompare(right.chunkId);
  });

  return scored.slice(0, MAX_ANSWER_CHUNKS);
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

function extractConfirmedFacts(
  coveredAsks: AskDefinition[],
  citations: Citation[],
  question: string
): string[] {
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

  if (facts.length > 0) {
    return Array.from(new Set(facts)).slice(0, 5);
  }

  const questionKeywords = extractQuestionKeywords(question);
  const genericFacts: string[] = [];

  for (const citation of citations) {
    const sentences = splitSentences(citation.quotedSnippet);
    for (const sentence of sentences) {
      const normalizedSentence = sentence.toLowerCase();
      if (questionKeywords.some((keyword) => normalizedSentence.includes(keyword))) {
        genericFacts.push(sentence);
      }
    }
  }

  return Array.from(new Set(genericFacts)).slice(0, 5);
}

function sanitizeFact(fact: string): string {
  return fact
    .replace(/^#+\s*/g, "")
    .replace(/^\*+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPartialAnswer(confirmedFacts: string[], missingLabels: string[]): string {
  const normalizedFacts = confirmedFacts.map((fact) => `- ${sanitizeFact(fact)}`).join("\n");
  const normalizedMissing = missingLabels.map((label) => `- ${label}`).join("\n");

  return `${PARTIAL_TEMPLATE_HEADER}\n${normalizedFacts}\n${PARTIAL_TEMPLATE_MISSING}\n${normalizedMissing}`;
}

function buildFullAnswer(confirmedFacts: string[]): string {
  if (confirmedFacts.length === 0) {
    return NOT_SPECIFIED_RESPONSE_TEXT;
  }

  return confirmedFacts.map((fact) => `- ${sanitizeFact(fact)}`).join("\n");
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
  const mfaContext =
    /\bmfa\b|multi[- ]factor/i.test(question) || /\bmfa\b|multi[- ]factor/i.test(answer);
  const claimsRequired = /\brequired\b/i.test(answer);

  if (!mfaContext || !claimsRequired) {
    return answer;
  }

  if (isMfaRequiredSupported(citations)) {
    return answer;
  }

  return MFA_REQUIRED_FALLBACK;
}

function extractCitationRelevanceTerms(question: string): string[] {
  const keywordTerms = extractStrongQuestionKeywords(extractQuestionKeywords(question)).filter(
    (term) => term.length >= 4
  );

  if (keywordTerms.length > 0) {
    return keywordTerms;
  }

  const fallbackTerms = extractQuestionKeyTerms(question).filter(
    (term) => term.length >= 4 && !WEAK_QUESTION_KEYWORDS.has(term)
  );

  return fallbackTerms;
}

function isCitationRelevant(question: string, citation: Citation): boolean {
  const relevanceTerms = extractCitationRelevanceTerms(question);
  if (relevanceTerms.length === 0) {
    return true;
  }

  const snippet = citation.quotedSnippet.toLowerCase();
  return relevanceTerms.some((term) => snippet.includes(term));
}

function selectRelevantCitations(question: string, citations: Citation[]): Citation[] {
  return citations.filter((citation) => isCitationRelevant(question, citation)).slice(0, MAX_CITATIONS);
}

function hasFormatViolation(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) {
    return true;
  }

  if (/^\s*#\s*evidence pack/i.test(trimmed)) {
    return true;
  }

  if (/(^|\n)\s*##\s+/.test(trimmed)) {
    return true;
  }

  if (/```/.test(trimmed)) {
    return true;
  }

  if (trimmed.length > 1800 && (trimmed.match(/\n/g) ?? []).length > 12) {
    return true;
  }

  return false;
}

async function generateWithFormatEnforcement(params: {
  question: string;
  snippets: Array<{ chunkId: string; docName: string; quotedSnippet: string }>;
}) {
  let first = (await generateGroundedAnswer({
    question: params.question,
    snippets: params.snippets
  })) as GroundedAnswerModelOutput;

  if (!hasFormatViolation(first.answer)) {
    return {
      output: first,
      hadFormatViolation: false
    };
  }

  const strictQuestion =
    "Return concise security-answer text only. No markdown headings, no raw evidence dump. " +
    params.question;

  const second = (await generateGroundedAnswer({
    question: strictQuestion,
    snippets: params.snippets
  })) as GroundedAnswerModelOutput;

  if (!hasFormatViolation(second.answer)) {
    return {
      output: second,
      hadFormatViolation: true
    };
  }

  return {
    output: {
      answer: NOT_FOUND_TEXT,
      citationChunkIds: [],
      confidence: "low",
      needsReview: true
    } satisfies GroundedAnswerModelOutput,
    hadFormatViolation: true
  };
}

export function normalizeAnswerOutput(params: {
  question: string;
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  modelHadFormatViolation: boolean;
  citations: Citation[];
  overlapScores: number[];
}): EvidenceAnswer {
  const citations = dedupeCitations(params.citations);
  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const coverage = evaluateAsksCoverage(params.question, citations);
  const confirmedFacts = extractConfirmedFacts(coverage.coveredAsks, citations, params.question);
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

  if (coverage.missingAsks.length > 0) {
    if (confirmedFacts.length > 0) {
      answer = formatPartialAnswer(confirmedFacts, missingLabels);
    } else {
      answer = NOT_SPECIFIED_RESPONSE_TEXT;
    }

    outcome = "PARTIAL";
  } else {
    answer = buildFullAnswer(confirmedFacts);
    outcome = "FULL";
  }

  answer = enforceMfaRequiredClaim(params.question, answer, citations);

  if (answer === NOT_FOUND_TEXT) {
    return NOT_FOUND_RESPONSE;
  }

  if (params.modelHadFormatViolation && !containsNotSpecified(answer) && outcome === "FULL") {
    outcome = "PARTIAL";
    answer = formatPartialAnswer(confirmedFacts, missingLabels.length > 0 ? missingLabels : ["additional detail context"]);
  }

  const hasNotSpecified = containsNotSpecified(answer);
  const overlapTotal = params.overlapScores.reduce((sum, score) => sum + score, 0);
  const avgOverlap = params.overlapScores.length > 0 ? overlapTotal / params.overlapScores.length : 0;
  const anyZeroOverlap = params.overlapScores.some((score) => score <= 0);

  let needsReview =
    outcome === "PARTIAL" ||
    params.modelNeedsReview ||
    modelHadUnsupportedClaims ||
    params.modelHadFormatViolation ||
    hasNotSpecified;

  let confidence: "low" | "med" | "high" = "low";

  if (outcome === "PARTIAL") {
    confidence = coverage.missingAsks.length <= 1 && avgOverlap >= 3 ? "med" : "low";
  } else {
    if (!needsReview) {
      confidence = params.modelConfidence === "high" && avgOverlap >= 3 ? "high" : "med";
    } else {
      confidence = "low";
    }
  }

  if (needsReview || hasNotSpecified || anyZeroOverlap) {
    if (confidence === "high") {
      confidence = "med";
    }
  }

  if (needsReview && confidence === "high") {
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
  question: string;
  scoredChunks: ScoredChunk[];
}): Promise<AttemptResult> {
  const selectedChunks = params.scoredChunks.slice(0, MAX_ANSWER_CHUNKS);
  const bestSimilarity = selectedChunks[0]?.similarity ?? 0;
  const fallbackCitations = selectedChunks.map(buildCitationFromChunk);

  if (selectedChunks.length === 0 || bestSimilarity < MIN_TOP_SIMILARITY) {
    return {
      bestSimilarity,
      modelAnswer: NOT_FOUND_TEXT,
      modelConfidence: "low",
      modelNeedsReview: true,
      modelHadFormatViolation: false,
      citationsFromModel: [],
      fallbackCitations,
      scoredChunks: selectedChunks
    };
  }

  const snippets = selectedChunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName,
    quotedSnippet: chunk.quotedSnippet
  }));

  const generation = await generateWithFormatEnforcement({
    question: params.question,
    snippets
  });

  const chunkById = new Map(selectedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citationsFromModel = Array.from(new Set(generation.output.citationChunkIds))
    .map((chunkId) => chunkById.get(chunkId))
    .filter((value): value is ScoredChunk => Boolean(value))
    .map(buildCitationFromChunk);

  return {
    bestSimilarity,
    modelAnswer: generation.output.answer,
    modelConfidence: generation.output.confidence,
    modelNeedsReview: generation.output.needsReview,
    modelHadFormatViolation: generation.hadFormatViolation,
    citationsFromModel,
    fallbackCitations,
    scoredChunks: selectedChunks
  };
}

function selectCitationsForNormalization(question: string, attempt: AttemptResult): Citation[] {
  if (
    attempt.modelHadFormatViolation &&
    attempt.modelAnswer.trim() === NOT_FOUND_TEXT &&
    attempt.citationsFromModel.length === 0
  ) {
    return [];
  }

  const merged = dedupeCitations([...attempt.citationsFromModel, ...attempt.fallbackCitations]);
  return selectRelevantCitations(question, merged);
}

async function retrieveRelevantChunks(params: {
  organizationId: string;
  question: string;
  questionEmbedding: number[];
}): Promise<ScoredChunk[]> {
  const initialChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: TOP_K
  });

  let filtered = filterAndRerankChunks(params.question, initialChunks);
  if (filtered.length > 0) {
    return filtered;
  }

  const retryChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: RETRY_TOP_K
  });

  filtered = filterAndRerankChunks(params.question, retryChunks);
  return filtered;
}

async function retryWithAdditionalChunks(params: {
  organizationId: string;
  question: string;
  questionEmbedding: number[];
  excludeChunkIds: Set<string>;
}): Promise<ScoredChunk[]> {
  const retryChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: RETRY_TOP_K
  });

  return filterAndRerankChunks(params.question, retryChunks).filter(
    (chunk) => !params.excludeChunkIds.has(chunk.chunkId)
  );
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
  const relevantChunks = await retrieveRelevantChunks({
    organizationId: params.organizationId,
    question,
    questionEmbedding
  });

  if (relevantChunks.length === 0 || relevantChunks[0].similarity < MIN_TOP_SIMILARITY) {
    return NOT_FOUND_RESPONSE;
  }

  let attempt = await runAnswerAttempt({
    question,
    scoredChunks: relevantChunks
  });

  let citations = selectCitationsForNormalization(question, attempt);
  if (citations.length === 0 && attempt.bestSimilarity >= MIN_TOP_SIMILARITY) {
    const retryChunks = await retryWithAdditionalChunks({
      organizationId: params.organizationId,
      question,
      questionEmbedding,
      excludeChunkIds: new Set(attempt.scoredChunks.map((chunk) => chunk.chunkId))
    });

    if (retryChunks.length > 0) {
      const retryAttempt = await runAnswerAttempt({
        question,
        scoredChunks: retryChunks
      });

      const retryCitations = selectCitationsForNormalization(question, retryAttempt);
      if (retryCitations.length > 0) {
        attempt = retryAttempt;
        citations = retryCitations;
      }
    }
  }

  if (citations.length === 0 || attempt.bestSimilarity < MIN_TOP_SIMILARITY) {
    return NOT_FOUND_RESPONSE;
  }

  const overlapByChunk = new Map(attempt.scoredChunks.map((chunk) => [chunk.chunkId, chunk.overlapScore]));

  return normalizeAnswerOutput({
    question,
    modelAnswer: attempt.modelAnswer,
    modelConfidence: attempt.modelConfidence,
    modelNeedsReview: attempt.modelNeedsReview,
    modelHadFormatViolation: attempt.modelHadFormatViolation,
    citations,
    overlapScores: citations.map((citation) => overlapByChunk.get(citation.chunkId) ?? 0)
  });
}
