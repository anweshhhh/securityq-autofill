export const NOT_SPECIFIED_RESPONSE_TEXT = "Not specified in provided documents.";

const STOPWORDS = new Set([
  "about",
  "across",
  "after",
  "answer",
  "based",
  "before",
  "between",
  "could",
  "documents",
  "evidence",
  "given",
  "likely",
  "maybe",
  "might",
  "provided",
  "question",
  "should",
  "since",
  "there",
  "these",
  "those",
  "using",
  "while",
  "within",
  "would"
]);

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function collectMatches(target: Set<string>, value: string, regex: RegExp) {
  for (const match of value.matchAll(regex)) {
    const token = normalizeSearchText(match[0]);
    if (!token || STOPWORDS.has(token)) {
      continue;
    }

    target.add(token);
  }
}

export function extractKeyTokens(value: string): string[] {
  const tokens = new Set<string>();
  const normalizedInput = value.replace(
    /not specified in provided documents\./gi,
    " "
  );

  collectMatches(tokens, normalizedInput, /\b(?:tls|ssl)\s*\d+(?:\.\d+)?\b/gi);
  collectMatches(tokens, normalizedInput, /\b[a-zA-Z]+-\d+(?:\.\d+)?\b/g);
  collectMatches(tokens, normalizedInput, /\b[a-z]+[A-Z][a-zA-Z0-9]*\b/g);
  collectMatches(tokens, normalizedInput, /\b[A-Z]{2,}(?:-\d+)?\b/g);
  collectMatches(tokens, normalizedInput, /\b\d+(?:\.\d+)+\b/g);
  collectMatches(tokens, normalizedInput, /\b[a-zA-Z][a-zA-Z0-9-]{4,}\b/g);

  return Array.from(tokens);
}

export function findUnsupportedKeyTokens(params: {
  answer: string;
  quotedSnippets: string[];
}): string[] {
  const normalizedSnippets = normalizeSearchText(params.quotedSnippets.join(" "));
  const answerTokens = extractKeyTokens(params.answer);

  return answerTokens.filter((token) => !normalizedSnippets.includes(token));
}

export function applyClaimCheckGuardrails(params: {
  answer: string;
  quotedSnippets: string[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
}) {
  const answer = params.answer.trim();
  const unsupportedTokens = findUnsupportedKeyTokens({
    answer,
    quotedSnippets: params.quotedSnippets
  });

  if (unsupportedTokens.length > 0) {
    return {
      answer: NOT_SPECIFIED_RESPONSE_TEXT,
      confidence: "low" as const,
      needsReview: true,
      unsupportedTokens
    };
  }

  if (answer.includes(NOT_SPECIFIED_RESPONSE_TEXT)) {
    return {
      answer,
      confidence: "low" as const,
      needsReview: true,
      unsupportedTokens
    };
  }

  if (params.needsReview && params.confidence === "high") {
    return {
      answer,
      confidence: "med" as const,
      needsReview: true,
      unsupportedTokens
    };
  }

  return {
    answer,
    confidence: params.confidence,
    needsReview: params.needsReview,
    unsupportedTokens
  };
}
