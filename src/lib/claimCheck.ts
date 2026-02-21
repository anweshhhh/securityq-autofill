export const NOT_SPECIFIED_RESPONSE_TEXT = "Not specified in provided documents.";

const STOPWORDS = new Set([
  "about",
  "across",
  "after",
  "against",
  "answer",
  "based",
  "before",
  "between",
  "could",
  "details",
  "documents",
  "evidence",
  "given",
  "have",
  "into",
  "like",
  "likely",
  "maybe",
  "might",
  "only",
  "please",
  "provide",
  "provided",
  "question",
  "regarding",
  "should",
  "since",
  "than",
  "that",
  "their",
  "there",
  "these",
  "those",
  "using",
  "what",
  "when",
  "which",
  "while",
  "with",
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

export function extractQuestionKeyTerms(question: string): string[] {
  const tokens = question.match(/\b[a-zA-Z][a-zA-Z0-9-]{3,}\b/g) ?? [];

  return Array.from(
    new Set(
      tokens
        .map((token) => token.toLowerCase())
        .filter((token) => !STOPWORDS.has(token))
    )
  );
}

export function extractKeyTokens(value: string): string[] {
  const tokens = new Set<string>();
  const normalizedInput = value.replace(/not specified in provided documents\./gi, " ");

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

  if (answer.toLowerCase().includes(NOT_SPECIFIED_RESPONSE_TEXT.toLowerCase())) {
    return {
      answer,
      confidence: "low" as const,
      needsReview: true,
      unsupportedTokens: [] as string[]
    };
  }

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
