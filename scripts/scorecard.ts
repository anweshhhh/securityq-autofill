import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const NOT_FOUND_TEMPLATE = "Not found in provided documents.";
const PARTIAL_TEMPLATE = "Not specified in provided documents.";
const BUILD_LOG_PATH = path.join(process.cwd(), "docs", "build-log.md");

type ScoreStatus = "FOUND" | "PARTIAL" | "NOT_FOUND";

type CategoryStats = {
  found: number;
  partial: number;
  notFound: number;
  citationIssues: number;
};

function normalize(value: string): string {
  return value.trim();
}

function classifyAnswer(answer: string): ScoreStatus {
  const normalized = normalize(answer);
  if (!normalized || normalized === NOT_FOUND_TEMPLATE) {
    return "NOT_FOUND";
  }

  if (normalized === PARTIAL_TEMPLATE) {
    return "PARTIAL";
  }

  return "FOUND";
}

function hasCitations(citations: string): boolean {
  return normalize(citations).length > 0;
}

function ensureRequiredColumns(headers: string[]) {
  const required = ["Answer", "Citations"];
  for (const column of required) {
    if (!headers.includes(column)) {
      throw new Error(`Missing required column: ${column}`);
    }
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseCsvRows(text: string): Array<Record<string, string>> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy"
  });

  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  return parsed.data.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[String(key)] = value == null ? "" : String(value);
    }
    return normalized;
  });
}

function run() {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    console.error("Usage: npm run scorecard -- <path-to-export.csv>");
    process.exit(1);
  }

  const resolvedCsvPath = path.resolve(process.cwd(), csvPathArg);
  const csvText = readFileSync(resolvedCsvPath, "utf8");
  const rows = parseCsvRows(csvText);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  ensureRequiredColumns(headers);

  let found = 0;
  let partial = 0;
  let notFound = 0;

  let foundOrPartialWithCitations = 0;
  let foundOrPartialMissingCitations = 0;
  let notFoundWithEmptyCitations = 0;
  let notFoundWithCitations = 0;

  const perCategory = new Map<string, CategoryStats>();

  for (const row of rows) {
    const category = normalize(row.Category ?? "") || "Uncategorized";
    const answer = row.Answer ?? "";
    const citations = row.Citations ?? "";
    const status = classifyAnswer(answer);
    const citationsPresent = hasCitations(citations);

    if (!perCategory.has(category)) {
      perCategory.set(category, {
        found: 0,
        partial: 0,
        notFound: 0,
        citationIssues: 0
      });
    }
    const categoryStats = perCategory.get(category)!;

    if (status === "FOUND") {
      found += 1;
      categoryStats.found += 1;
    } else if (status === "PARTIAL") {
      partial += 1;
      categoryStats.partial += 1;
    } else {
      notFound += 1;
      categoryStats.notFound += 1;
    }

    if (status === "FOUND" || status === "PARTIAL") {
      if (citationsPresent) {
        foundOrPartialWithCitations += 1;
      } else {
        foundOrPartialMissingCitations += 1;
        categoryStats.citationIssues += 1;
      }
    } else if (citationsPresent) {
      notFoundWithCitations += 1;
      categoryStats.citationIssues += 1;
    } else {
      notFoundWithEmptyCitations += 1;
    }
  }

  const categoryLines = [...perCategory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([category, stats]) =>
        `- ${category}: FOUND=${stats.found}, PARTIAL=${stats.partial}, NOT_FOUND=${stats.notFound}, citationIssues=${stats.citationIssues}`
    );

  const outputLines = [
    "Autofill Scorecard",
    `File: ${resolvedCsvPath}`,
    `Rows: ${rows.length}`,
    `FOUND: ${found}`,
    `PARTIAL: ${partial}`,
    `NOT_FOUND: ${notFound}`,
    "",
    "Citation Compliance",
    `- FOUND/PARTIAL with citations: ${foundOrPartialWithCitations}`,
    `- FOUND/PARTIAL missing citations: ${foundOrPartialMissingCitations}`,
    `- NOT_FOUND with empty citations: ${notFoundWithEmptyCitations}`,
    `- NOT_FOUND with citations present: ${notFoundWithCitations}`,
    "",
    "Per-category Breakdown",
    ...(categoryLines.length > 0 ? categoryLines : ["- none"])
  ];

  const output = outputLines.join("\n");
  console.log(output);

  const datedEntry = [
    "",
    `## ${formatDate(new Date())} - scorecard (${path.basename(resolvedCsvPath)})`,
    "",
    "```text",
    output,
    "```"
  ].join("\n");

  appendFileSync(BUILD_LOG_PATH, datedEntry);
}

run();
