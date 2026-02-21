import { prisma } from "@/lib/prisma";

export const DEFAULT_TOP_K = 5;
export const DEFAULT_SNIPPET_CHARS = 520;

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

function getQuestionAnchorTokens(questionText: string): string[] {
  const tokens = questionText.match(/\b[a-zA-Z][a-zA-Z0-9-]{3,}\b/g) ?? [];
  return Array.from(new Set(tokens.map((token) => token.toLowerCase()))).slice(0, 20);
}

function selectContextSnippet(params: {
  content: string;
  anchorTokens: string[];
  snippetChars: number;
}): string {
  const normalizedContent = normalizeWhitespace(params.content);
  if (!normalizedContent) {
    return "";
  }

  if (normalizedContent.length <= params.snippetChars) {
    return normalizedContent;
  }

  const contentLower = normalizedContent.toLowerCase();
  let anchorIndex = -1;

  for (const token of params.anchorTokens) {
    const index = contentLower.indexOf(token);
    if (index >= 0 && (anchorIndex === -1 || index < anchorIndex)) {
      anchorIndex = index;
    }
  }

  if (anchorIndex < 0) {
    return normalizedContent.slice(0, params.snippetChars).trim();
  }

  const contextBefore = Math.floor(params.snippetChars / 3);
  const start = Math.max(0, anchorIndex - contextBefore);
  const end = Math.min(normalizedContent.length, start + params.snippetChars);

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
