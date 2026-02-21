import { prisma } from "@/lib/prisma";

export const DEFAULT_TOP_K = 5;
export const DEFAULT_SNIPPET_CHARS = 300;

export const RETRIEVAL_SQL = `
SELECT
  dc."id" AS "chunkId",
  d."name" AS "docName",
  LEFT(dc."content", $4::int) AS "quotedSnippet",
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
  similarity: number;
};

type RetrievalRow = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
  distance: number;
};

type QueryClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export function embeddingToVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
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
  topK?: number;
  snippetChars?: number;
  db?: QueryClient;
}): Promise<RetrievedChunk[]> {
  const db = params.db ?? prisma;
  const topK = params.topK ?? DEFAULT_TOP_K;
  const snippetChars = params.snippetChars ?? DEFAULT_SNIPPET_CHARS;

  const rows = await db.$queryRawUnsafe<RetrievalRow[]>(
    RETRIEVAL_SQL,
    embeddingToVectorLiteral(params.questionEmbedding),
    params.organizationId,
    topK,
    snippetChars
  );

  const mapped = rows.map((row) => ({
    chunkId: row.chunkId,
    docName: row.docName,
    quotedSnippet: row.quotedSnippet,
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
