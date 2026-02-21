import Papa from "papaparse";

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

const CSV_EXTENSIONS = [".csv"];
const CSV_MIME_TYPES = ["text/csv", "application/csv", "application/vnd.ms-excel"];

export function isCsvFile(file: Pick<File, "name" | "type">): boolean {
  const lowerName = file.name.toLowerCase();
  if (CSV_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return true;
  }

  return CSV_MIME_TYPES.includes(file.type);
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  const text = await file.text();
  return parseCsvText(text);
}

export function parseCsvText(text: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`CSV parse error: ${firstError.message}`);
  }

  const headers = (parsed.meta.fields ?? []).map((field) => field.trim()).filter(Boolean);
  if (headers.length === 0) {
    throw new Error("CSV must include at least one header");
  }

  const rows = parsed.data.map((row) => {
    const normalizedRow: Record<string, string> = {};
    for (const header of headers) {
      const value = row[header];
      normalizedRow[header] = value == null ? "" : String(value);
    }

    return normalizedRow;
  });

  return { headers, rows };
}

export function suggestQuestionColumn(headers: string[]): string {
  const byKeyword = headers.find((header) => header.toLowerCase().includes("question"));
  return byKeyword ?? headers[0] ?? "";
}
