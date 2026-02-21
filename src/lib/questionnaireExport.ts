import type { Citation } from "@/lib/answering";

const MAX_CITATION_STRING_CHARS = 700;
const MAX_SNIPPET_CHARS = 120;

export type QuestionnaireExportRow = {
  sourceRow: Record<string, string>;
  answer: string;
  citations: Citation[];
  confidence: string;
  needsReview: boolean;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function formatCitationsCompact(citations: Citation[]): string {
  if (citations.length === 0) {
    return "";
  }

  let result = "";

  for (const citation of citations) {
    const snippet = truncate(normalizeWhitespace(citation.quotedSnippet), MAX_SNIPPET_CHARS);
    const segment = `${citation.docName}#${citation.chunkId}: \"${snippet}\"`;
    const next = result ? `${result} | ${segment}` : segment;

    if (next.length > MAX_CITATION_STRING_CHARS) {
      if (!result) {
        return truncate(segment, MAX_CITATION_STRING_CHARS);
      }

      return truncate(result, MAX_CITATION_STRING_CHARS);
    }

    result = next;
  }

  return result;
}

export function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildQuestionnaireExportCsv(
  originalHeaders: string[],
  rows: QuestionnaireExportRow[]
): string {
  const exportHeaders = [...originalHeaders, "Answer", "Citations", "Confidence", "Needs Review"];

  const headerLine = exportHeaders.map((header) => escapeCsvValue(header)).join(",");

  const dataLines = rows.map((row) => {
    const baseColumns = originalHeaders.map((header) => escapeCsvValue(row.sourceRow[header] ?? ""));
    const answerColumns = [
      escapeCsvValue(row.answer),
      escapeCsvValue(formatCitationsCompact(row.citations)),
      escapeCsvValue(row.confidence),
      escapeCsvValue(String(row.needsReview))
    ];

    return [...baseColumns, ...answerColumns].join(",");
  });

  return [headerLine, ...dataLines].join("\n");
}
