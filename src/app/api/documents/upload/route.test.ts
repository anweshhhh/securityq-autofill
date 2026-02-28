import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const { createEmbeddingMock, getRequestContextMock, MockRequestContextError } = vi.hoisted(() => {
  class MockRequestContextError extends Error {
    code: string;
    status: number;

    constructor(message: string, options: { code: string; status: number }) {
      super(message);
      this.code = options.code;
      this.status = options.status;
    }
  }

  return {
    createEmbeddingMock: vi.fn(),
    getRequestContextMock: vi.fn(),
    MockRequestContextError
  };
});

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock,
  RequestContextError: MockRequestContextError
}));

import { POST as embedRoute } from "../embed/route";
import { POST as uploadRoute } from "./route";

const TEST_FILE_PREFIX = "vitest-mvp-ingestion-";
const TEST_ORG_PREFIX = "vitest-mvp-ingestion-org-";
let isolatedOrgId: string | null = null;

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
    getRequestContextMock.mockReset();
    await cleanupTestDocuments();

    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });
    isolatedOrgId = organization.id;
    getRequestContextMock.mockResolvedValue({
      userId: `vitest-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });
  });

  afterEach(async () => {
    await cleanupTestDocuments();
    if (isolatedOrgId) {
      await prisma.organization
        .delete({
          where: {
            id: isolatedOrgId
          }
        })
        .catch(() => {
          // Ignore cleanup failures from already-removed rows.
        });
      isolatedOrgId = null;
    }
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

  it("uploads PDF evidence and chunks extracted page text", async () => {
    const fixturePath = join(process.cwd(), "test/fixtures/evidence-c.pdf");
    const pdfBytes = readFileSync(fixturePath);
    const fileName = `${TEST_FILE_PREFIX}${Date.now()}.pdf`;

    const formData = new FormData();
    formData.append("file", new File([pdfBytes], fileName, { type: "application/pdf" }));

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

    const uploadedDocument = await prisma.document.findUnique({
      where: { id: uploadPayload.document?.id ?? "" },
      select: { mimeType: true }
    });
    expect(uploadedDocument?.mimeType).toBe("application/pdf");

    const uploadedChunks = await prisma.documentChunk.findMany({
      where: { documentId: uploadPayload.document?.id },
      orderBy: { chunkIndex: "asc" },
      select: { content: true }
    });

    const combinedContent = uploadedChunks.map((chunk) => chunk.content).join("\n");
    expect(combinedContent).toContain("Page 1");
    expect(combinedContent).toContain("TLS 1.2");
    expect(combinedContent).toContain("Encryption at rest uses AES-256");
  });

  it("returns JSON error payload when file field is missing", async () => {
    const formData = new FormData();
    formData.append("not-file", "value");

    const uploadResponse = await uploadRoute(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: formData
      })
    );
    const uploadPayload = (await uploadResponse.json()) as {
      error?: {
        message?: string;
        code?: string;
      };
    };

    expect(uploadResponse.status).toBe(400);
    expect(uploadPayload.error?.message).toBe("file is required");
    expect(uploadPayload.error?.code).toBe("UPLOAD_FILE_REQUIRED");
  });
});
