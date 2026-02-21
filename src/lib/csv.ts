import Papa from "papaparse";

export const MAX_CSV_BYTES = 8 * 1024 * 1024;
export const CSV_PREVIEW_ROWS = 10;

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

export type CsvPreview = {
  headers: string[];
  previewRows: Array<Record<string, string>>;
  totalRowCount: number;
  suggestedQuestionColumn: string;
};

const CSV_EXTENSIONS = [".csv"];
const CSV_MIME_TYPES = ["text/csv", "application/csv", "application/vnd.ms-excel"];
const QUESTION_HEADER_HINTS = ["question", "prompt", "security question", "req", "requirement"];

function removeBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function normalizeHeaderName(value: string, index: number): string {
  const trimmed = removeBom(value).trim();
  return trimmed || `Column ${index + 1}`;
}

function dedupeHeaders(rawHeaders: string[]): string[] {
  const counts = new Map<string, number>();

  return rawHeaders.map((rawHeader, index) => {
    const normalized = normalizeHeaderName(rawHeader, index);
    const current = counts.get(normalized) ?? 0;
    counts.set(normalized, current + 1);

    return current === 0 ? normalized : `${normalized} (${current + 1})`;
  });
}

function normalizeRow(headers: string[], rowValues: string[]): Record<string, string> {
  const row: Record<string, string> = {};

  for (let index = 0; index < headers.length; index += 1) {
    row[headers[index]] = rowValues[index] ?? "";
  }

  return row;
}

export function isCsvFile(file: Pick<File, "name" | "type">): boolean {
  const lowerName = file.name.toLowerCase();
  if (CSV_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return true;
  }

  return CSV_MIME_TYPES.includes(file.type);
}

export function suggestQuestionColumn(headers: string[]): string {
  if (headers.length === 0) {
    return "";
  }

  const scored = headers.map((header) => {
    const lowerHeader = header.toLowerCase();
    let score = 0;

    for (const hint of QUESTION_HEADER_HINTS) {
      if (lowerHeader.includes(hint)) {
        score += hint.length;
      }
    }

    return { header, score };
  });

  scored.sort((left, right) => right.score - left.score);

  return scored[0].score > 0 ? scored[0].header : headers[0];
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  if (file.size > MAX_CSV_BYTES) {
    throw new Error(`CSV file exceeds size limit of ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))}MB`);
  }

  const text = await file.text();
  return parseCsvText(text);
}

export function parseCsvText(text: string): ParsedCsv {
  const cleanedText = removeBom(text);

  const parsed = Papa.parse<string[]>(cleanedText, {
    header: false,
    skipEmptyLines: "greedy"
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`CSV parse error: ${firstError.message}`);
  }

  const data = parsed.data;
  if (!data || data.length === 0) {
    throw new Error("CSV must include headers and at least one row");
  }

  const rawHeaders = data[0].map((header) => String(header ?? ""));
  const headers = dedupeHeaders(rawHeaders);

  if (headers.length === 0) {
    throw new Error("CSV must include at least one header");
  }

  const rows = data.slice(1).map((values) => normalizeRow(headers, values.map((value) => String(value ?? ""))));

  return { headers, rows };
}

export function buildCsvPreview(parsed: ParsedCsv): CsvPreview {
  return {
    headers: parsed.headers,
    previewRows: parsed.rows.slice(0, CSV_PREVIEW_ROWS),
    totalRowCount: parsed.rows.length,
    suggestedQuestionColumn: suggestQuestionColumn(parsed.headers)
  };
}
