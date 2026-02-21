import type { Citation } from "@/lib/answering";
import { formatCitationsCompact } from "@/lib/citations";

export type QuestionnaireExportRow = {
  sourceRow: Record<string, string>;
  answer: string;
  citations: Citation[];
  confidence: string;
  needsReview: boolean;
};

export const EXPORT_APPEND_HEADERS = ["Answer", "Citations", "Confidence", "Needs Review"];

export function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildQuestionnaireExportCsv(
  originalHeaders: string[],
  rows: QuestionnaireExportRow[]
): string {
  const headers = [...originalHeaders, ...EXPORT_APPEND_HEADERS];
  const headerLine = headers.map((header) => escapeCsvValue(header)).join(",");

  const dataLines = rows.map((row) => {
    const sourceColumns = originalHeaders.map((header) => escapeCsvValue(row.sourceRow[header] ?? ""));

    const appendedColumns = [
      escapeCsvValue(row.answer),
      escapeCsvValue(formatCitationsCompact(row.citations)),
      escapeCsvValue(row.confidence),
      escapeCsvValue(String(row.needsReview))
    ];

    return [...sourceColumns, ...appendedColumns].join(",");
  });

  return [headerLine, ...dataLines].join("\n");
}
