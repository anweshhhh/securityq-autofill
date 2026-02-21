import { prisma } from "@/lib/prisma";

export const DEFAULT_TOP_K = 5;
export const DEFAULT_SNIPPET_CHARS = 700;
const MIN_SNIPPET_CHARS = 250;
const SECTION_SNIPPET_MAX_LINES = 12;
const SECTION_SNIPPET_MAX_CHARS = 1200;

export const RETRIEVAL_SQL = `
SELECT
  dc."id" AS "chunkId",
  d."name" AS "docName",
  dc."content" AS "content",
  (dc."embedding" <=> $1::vector) AS "distance"
FROM "DocumentChunk" dc
JOIN "Document" d ON d."id" = dc."documentId"
WHERE d."organizationId" = $2
  AND dc."embedding" IS NOT NULL
ORDER BY distance ASC, dc."id" ASC
LIMIT $3
`;

export type RetrievedChunk = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
  fullContent: string;
  similarity: number;
};

type RetrievalRow = {
  chunkId: string;
  docName: string;
  content: string;
  distance: number;
};

type QueryClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/^#{1,6}\s+/.test(trimmed)) {
    return true;
  }

  return /^[A-Za-z][A-Za-z0-9 &/()\-]{2,}:\s*$/.test(trimmed);
}

function lineContainsToken(line: string, token: string): boolean {
  return line.toLowerCase().includes(token.toLowerCase());
}

function findAnchorLineIndex(lines: string[], anchorTokens: string[]): number {
  if (anchorTokens.length === 0) {
    return -1;
  }

  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let score = 0;

    for (const token of anchorTokens) {
      if (lineContainsToken(line, token)) {
        score += 1;
      }
    }

    if (score > 0 && isHeadingLine(line)) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function findHeadingLineIndex(lines: string[], fromIndex: number): number {
  for (let index = Math.max(0, fromIndex); index >= 0; index -= 1) {
    if (isHeadingLine(lines[index])) {
      return index;
    }
  }

  return -1;
}

function buildSectionSnippet(params: {
  lines: string[];
  startLineIndex: number;
  maxLines: number;
  maxChars: number;
}): string {
  const selectedLines: string[] = [];
  let currentChars = 0;

  for (
    let index = params.startLineIndex;
    index < params.lines.length && selectedLines.length < params.maxLines;
    index += 1
  ) {
    const nextLine = params.lines[index];
    const extraChars = (selectedLines.length > 0 ? 1 : 0) + nextLine.length;

    if (currentChars + extraChars > params.maxChars) {
      break;
    }

    selectedLines.push(nextLine);
    currentChars += extraChars;
  }

  let snippet = selectedLines.join("\n").trim();
  if (!snippet) {
    return "";
  }

  if (/recovery objectives/i.test(snippet) && (!/\brto\b/i.test(snippet) || !/\brpo\b/i.test(snippet))) {
    const lastIndex = params.startLineIndex + selectedLines.length;
    for (
      let index = lastIndex;
      index < params.lines.length && selectedLines.length < params.maxLines + 6;
      index += 1
    ) {
      const nextLine = params.lines[index];
      const extraChars = 1 + nextLine.length;
      if (currentChars + extraChars > params.maxChars) {
        break;
      }

      selectedLines.push(nextLine);
      currentChars += extraChars;

      const expandedSnippet = selectedLines.join("\n");
      if (/\brto\b/i.test(expandedSnippet) && /\brpo\b/i.test(expandedSnippet)) {
        break;
      }
    }

    snippet = selectedLines.join("\n").trim();
  }

  return snippet;
}

function selectSectionSnippet(params: {
  content: string;
  anchorTokens: string[];
  snippetChars: number;
}): string | null {
  const rawContent = normalizeNewlines(params.content).trim();
  if (!rawContent) {
    return null;
  }

  const lines = rawContent.split("\n");
  const anchorLineIndex = findAnchorLineIndex(lines, params.anchorTokens);
  if (anchorLineIndex < 0) {
    return null;
  }

  const headingLineIndex = findHeadingLineIndex(lines, anchorLineIndex);
  const startLineIndex = headingLineIndex >= 0 ? headingLineIndex : anchorLineIndex;
  const maxChars = Math.max(params.snippetChars, SECTION_SNIPPET_MAX_CHARS);

  const snippet = buildSectionSnippet({
    lines,
    startLineIndex,
    maxLines: SECTION_SNIPPET_MAX_LINES,
    maxChars
  });

  return snippet || null;
}

function getQuestionAnchorTokens(questionText: string): string[] {
  const tokens = new Set<string>();

  for (const token of questionText.match(/\b[a-zA-Z][a-zA-Z0-9-]{3,}\b/g) ?? []) {
    tokens.add(token.toLowerCase());
  }

  for (const token of questionText.match(/\b(?:tls|ssl|mfa|sig|soc2)\b/gi) ?? []) {
    tokens.add(token.toLowerCase());
  }

  for (const token of questionText.match(/\b(?:rto|rpo|sdlc|ir)\b/gi) ?? []) {
    tokens.add(token.toLowerCase());
  }

  for (const token of questionText.match(/\b\d+(?:\.\d+)+\b/g) ?? []) {
    tokens.add(token.toLowerCase());
  }

  return Array.from(tokens).slice(0, 24);
}

function findSentenceStart(text: string, index: number): number {
  for (let i = Math.max(0, index); i > 0; i -= 1) {
    const char = text[i];
    if (char === "." || char === "!" || char === "?" || char === "\n") {
      let start = i + 1;
      while (start < text.length && /\s/.test(text[start])) {
        start += 1;
      }

      return start;
    }
  }

  return 0;
}

function findSentenceEnd(text: string, index: number): number {
  for (let i = Math.min(text.length - 1, index); i < text.length; i += 1) {
    const char = text[i];
    if (char === "." || char === "!" || char === "?" || char === "\n") {
      return i + 1;
    }
  }

  return text.length;
}

function moveStartToWhitespaceBoundary(text: string, start: number): number {
  let nextStart = Math.max(0, start);
  while (nextStart > 0 && /\S/.test(text[nextStart - 1])) {
    nextStart -= 1;
  }

  return nextStart;
}

function moveEndToWhitespaceBoundary(text: string, end: number): number {
  let nextEnd = Math.min(text.length, end);
  while (nextEnd < text.length && /\S/.test(text[nextEnd])) {
    nextEnd += 1;
  }

  return nextEnd;
}

function moveEndToSentenceOrWhitespaceBoundary(text: string, end: number): number {
  const nextSentenceEnd = findSentenceEnd(text, end);
  if (nextSentenceEnd > end && nextSentenceEnd - end <= 120) {
    return nextSentenceEnd;
  }

  return moveEndToWhitespaceBoundary(text, end);
}

function selectContextSnippet(params: {
  content: string;
  anchorTokens: string[];
  snippetChars: number;
}): string {
  const sectionSnippet = selectSectionSnippet(params);
  if (sectionSnippet) {
    return sectionSnippet;
  }

  const normalizedContent = normalizeWhitespace(params.content);
  if (!normalizedContent) {
    return "";
  }

  if (normalizedContent.length <= params.snippetChars) {
    return normalizedContent;
  }

  const targetChars = Math.max(400, Math.min(800, params.snippetChars));
  const minChars = Math.min(MIN_SNIPPET_CHARS, targetChars);
  const contentLower = normalizedContent.toLowerCase();

  let anchorIndex = -1;
  for (const token of params.anchorTokens) {
    const index = contentLower.indexOf(token);
    if (index >= 0 && (anchorIndex < 0 || index < anchorIndex)) {
      anchorIndex = index;
    }
  }

  if (anchorIndex < 0) {
    let start = 0;
    let end = moveEndToSentenceOrWhitespaceBoundary(normalizedContent, targetChars);
    if (end - start > targetChars) {
      end = targetChars;
      end = moveEndToSentenceOrWhitespaceBoundary(normalizedContent, end);
    }

    return normalizedContent.slice(start, end).trim();
  }

  let start = findSentenceStart(normalizedContent, anchorIndex);
  let end = findSentenceEnd(normalizedContent, anchorIndex);

  if (end - start < minChars) {
    const extra = minChars - (end - start);
    const addBefore = Math.floor(extra / 2);
    const addAfter = extra - addBefore;
    start = Math.max(0, start - addBefore);
    end = Math.min(normalizedContent.length, end + addAfter);
  }

  start = moveStartToWhitespaceBoundary(normalizedContent, start);
  end = moveEndToSentenceOrWhitespaceBoundary(normalizedContent, end);

  if (end - start > targetChars) {
    end = start + targetChars;
    end = moveEndToSentenceOrWhitespaceBoundary(normalizedContent, end);
    if (end > normalizedContent.length) {
      end = normalizedContent.length;
    }

    if (end - start > targetChars) {
      start = Math.max(0, end - targetChars);
      start = moveStartToWhitespaceBoundary(normalizedContent, start);
    }
  }

  return normalizedContent.slice(start, end).trim();
}

export async function countEmbeddedChunksForOrganization(
  organizationId: string,
  db: QueryClient = prisma
): Promise<number> {
  const rows = (await db.$queryRawUnsafe<Array<{ count: number }>>(
    `
      SELECT COUNT(*)::int AS count
      FROM "DocumentChunk" dc
      JOIN "Document" d ON d."id" = dc."documentId"
      WHERE d."organizationId" = $1
        AND dc."embedding" IS NOT NULL
    `,
    organizationId
  )) as Array<{ count: number }>;

  return Number(rows[0]?.count ?? 0);
}

export async function retrieveTopChunks(params: {
  organizationId: string;
  questionEmbedding: number[];
  questionText?: string;
  topK?: number;
  snippetChars?: number;
  db?: QueryClient;
}): Promise<RetrievedChunk[]> {
  const db = params.db ?? prisma;
  const topK = params.topK ?? DEFAULT_TOP_K;
  const snippetChars = params.snippetChars ?? DEFAULT_SNIPPET_CHARS;
  const anchorTokens = getQuestionAnchorTokens(params.questionText ?? "");

  const rows = await db.$queryRawUnsafe<RetrievalRow[]>(
    RETRIEVAL_SQL,
    embeddingToVectorLiteral(params.questionEmbedding),
    params.organizationId,
    topK
  );

  const mapped = rows.map((row) => ({
    chunkId: row.chunkId,
    docName: row.docName,
    quotedSnippet: selectContextSnippet({
      content: row.content,
      anchorTokens,
      snippetChars
    }),
    fullContent: normalizeWhitespace(row.content),
    similarity: Math.max(0, 1 - Number(row.distance))
  }));

  mapped.sort((left, right) => {
    if (left.similarity === right.similarity) {
      return left.chunkId.localeCompare(right.chunkId);
    }

    return right.similarity - left.similarity;
  });

  return mapped;
}
