export const NOT_FOUND_TEXT = "Not found in provided documents.";
export const PARTIAL_TEXT = "Not specified in provided documents.";

export type AnswerKind = "NOT_FOUND" | "PARTIAL" | "FOUND";

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function normalizeTemplateText(text: string): string {
  const normalized = collapseWhitespace(text);
  if (!normalized) {
    return "";
  }

  if (normalized.toLowerCase() === NOT_FOUND_TEXT.toLowerCase()) {
    return NOT_FOUND_TEXT;
  }

  if (normalized.toLowerCase() === PARTIAL_TEXT.toLowerCase()) {
    return PARTIAL_TEXT;
  }

  return normalized;
}

export function canonicalizeAnswerOutput(input: {
  text: string;
  citations: any[];
}): {
  text: string;
  citations: any[];
  kind: AnswerKind;
} {
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const text = normalizeTemplateText(input.text);

  if (text === NOT_FOUND_TEXT) {
    return {
      text: NOT_FOUND_TEXT,
      citations: [],
      kind: "NOT_FOUND"
    };
  }

  if (text === PARTIAL_TEXT) {
    if (citations.length === 0) {
      return {
        text: NOT_FOUND_TEXT,
        citations: [],
        kind: "NOT_FOUND"
      };
    }

    return {
      text: PARTIAL_TEXT,
      citations,
      kind: "PARTIAL"
    };
  }

  if (citations.length === 0) {
    return {
      text: NOT_FOUND_TEXT,
      citations: [],
      kind: "NOT_FOUND"
    };
  }

  return {
    text,
    citations,
    kind: "FOUND"
  };
}
