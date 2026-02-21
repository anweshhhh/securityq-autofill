import type { Citation } from "@/lib/answering";

export const MAX_CITATION_STRING_CHARS = 1200;
export const MAX_SNIPPET_CHARS = 150;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateWithEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function formatCitation(citation: Citation): string {
  const snippet = truncateWithEllipsis(normalizeWhitespace(citation.quotedSnippet), MAX_SNIPPET_CHARS);
  return `${citation.docName}#${citation.chunkId}:"${snippet}"`;
}

export function formatCitationsCompact(citations: Citation[]): string {
  if (citations.length === 0) {
    return "";
  }

  let result = "";

  for (const citation of citations) {
    const segment = formatCitation(citation);
    const candidate = result ? `${result} | ${segment}` : segment;

    if (candidate.length > MAX_CITATION_STRING_CHARS) {
      if (!result) {
        return truncateWithEllipsis(segment, MAX_CITATION_STRING_CHARS);
      }

      return truncateWithEllipsis(result, MAX_CITATION_STRING_CHARS);
    }

    result = candidate;
  }

  return result;
}
