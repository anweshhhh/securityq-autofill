import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const { createEmbeddingMock } = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock
}));

import { POST as embedRoute } from "../embed/route";
import { POST as uploadRoute } from "./route";

const TEST_FILE_PREFIX = "vitest-mvp-ingestion-";

async function cleanupTestDocuments() {
  const testDocuments = await prisma.document.findMany({
    where: {
      originalName: {
        startsWith: TEST_FILE_PREFIX
      }
    },
    select: { id: true }
  });

  if (testDocuments.length === 0) {
    return;
  }

  const documentIds = testDocuments.map((document) => document.id);

  await prisma.documentChunk.deleteMany({
    where: {
      documentId: {
        in: documentIds
      }
    }
  });

  await prisma.document.deleteMany({
    where: {
      id: {
        in: documentIds
      }
    }
  });
}

describe.sequential("MVP ingestion contract", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    createEmbeddingMock.mockReset();
    await cleanupTestDocuments();
  });

  afterEach(async () => {
    await cleanupTestDocuments();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uploads text evidence, creates chunks, and embeds pending chunks", async () => {
    const fixturePath = join(process.cwd(), "test/fixtures/evidence-a.txt");
    const evidenceText = readFileSync(fixturePath, "utf8");
    const fileName = `${TEST_FILE_PREFIX}${Date.now()}.txt`;

    const formData = new FormData();
    formData.append("file", new File([evidenceText], fileName, { type: "text/plain" }));

    const uploadResponse = await uploadRoute(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: formData
      })
    );
    const uploadPayload = (await uploadResponse.json()) as {
      document?: {
        id: string;
        chunkCount: number;
      };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadPayload.document?.chunkCount).toBeGreaterThan(0);

    const uploadedChunks = await prisma.documentChunk.findMany({
      where: { documentId: uploadPayload.document?.id }
    });
    expect(uploadedChunks.length).toBeGreaterThan(0);

    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));

    const embedResponse = await embedRoute(new Request("http://localhost/api/documents/embed", { method: "POST" }));
    const embedPayload = (await embedResponse.json()) as { embeddedCount?: number };

    expect(embedResponse.status).toBe(200);
    expect(embedPayload.embeddedCount).toBeGreaterThan(0);

    const embeddedChunkRows = (await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `
        SELECT COUNT(*)::int AS count
        FROM "DocumentChunk" dc
        JOIN "Document" d ON d."id" = dc."documentId"
        WHERE d."id" = $1
          AND dc."embedding" IS NOT NULL
      `,
      uploadPayload.document?.id
    )) as Array<{ count: number }>;

    expect(Number(embeddedChunkRows[0]?.count ?? 0)).toBeGreaterThan(0);
  });
});
