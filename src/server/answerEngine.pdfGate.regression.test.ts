import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipRole } from "@prisma/client";
import { POST as embedRoute } from "@/app/api/documents/embed/route";
import { POST as uploadRoute } from "@/app/api/documents/upload/route";
import { prisma } from "@/lib/prisma";
import { answerQuestion } from "@/server/answerEngine";

const {
  createEmbeddingMock,
  generateEvidenceSufficiencyMock,
  generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiencyMock,
  getRequestContextMock,
  MockRequestContextError
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  getRequestContextMock: vi.fn(),
  MockRequestContextError: class MockRequestContextError extends Error {
    code: string;
    status: number;

    constructor(message: string, options: { code: string; status: number }) {
      super(message);
      this.code = options.code;
      this.status = options.status;
    }
  }
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiency: generateLegacyEvidenceSufficiencyMock
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock,
  RequestContextError: MockRequestContextError
}));

const TEST_FILE_PREFIX = "vitest-pdf-gate-";
const NOT_FOUND_TEXT = "Not found in provided documents.";
const TEST_ORG_PREFIX = "vitest-pdf-gate-org-";
let activeOrgId: string | null = null;

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

function hasPhrase(content: string, phrase: string): boolean {
  return content.toLowerCase().includes(phrase.toLowerCase());
}

describe.sequential("PDF sufficiency-gate regression", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";
    createEmbeddingMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    getRequestContextMock.mockReset();
    await cleanupTestDocuments();

    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });
    activeOrgId = organization.id;
    getRequestContextMock.mockResolvedValue({
      userId: `vitest-pdf-gate-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });
  });

  afterEach(async () => {
    await cleanupTestDocuments();
    if (activeOrgId) {
      await prisma.organization
        .delete({
          where: {
            id: activeOrgId
          }
        })
        .catch(() => {
          // Ignore cleanup race/absence in test teardown.
        });
      activeOrgId = null;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns cited non-NOT_FOUND answers when extractor gate finds supported values in PDF chunks", async () => {
    const fixturePath = join(process.cwd(), "test/fixtures/evidence-gate.pdf");
    const pdfBytes = readFileSync(fixturePath);
    const fileName = `${TEST_FILE_PREFIX}${Date.now()}.pdf`;

    const uploadFormData = new FormData();
    uploadFormData.append("file", new File([pdfBytes], fileName, { type: "application/pdf" }));

    const uploadResponse = await uploadRoute(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: uploadFormData
      })
    );
    const uploadPayload = (await uploadResponse.json()) as {
      document?: {
        id: string;
      };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadPayload.document?.id).toBeTruthy();
    const documentId = uploadPayload.document?.id as string;

    const chunks = await prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: "asc" },
      select: { id: true, content: true }
    });
    expect(chunks.length).toBeGreaterThan(0);

    // Verify required PDF-derived statements are present in stored chunk text.
    const requiredPhrases = [
      "least privilege",
      "restricted to authorized",
      "tls 1.2+",
      "minimum tls version",
      "mtls",
      "aes-256",
      "kms"
    ];

    for (const phrase of requiredPhrases) {
      expect(chunks.some((chunk) => hasPhrase(chunk.content, phrase))).toBe(true);
    }

    const leastPrivilegeChunkId = chunks.find((chunk) => hasPhrase(chunk.content, "least privilege"))?.id;
    const tlsChunkId = chunks.find((chunk) => hasPhrase(chunk.content, "tls 1.2"))?.id;
    const atRestChunkId = chunks.find((chunk) => hasPhrase(chunk.content, "aes-256"))?.id;

    expect(leastPrivilegeChunkId).toBeTruthy();
    expect(tlsChunkId).toBeTruthy();
    expect(atRestChunkId).toBeTruthy();

    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));
    const embedResponse = await embedRoute(new Request("http://localhost/api/documents/embed", { method: "POST" }));
    expect(embedResponse.status).toBe(200);

    const embeddedRows = (await prisma.$queryRawUnsafe<Array<{ embeddedCount: number }>>(
      `
        SELECT COUNT(*)::int AS "embeddedCount"
        FROM "DocumentChunk"
        WHERE "documentId" = $1
          AND "embedding" IS NOT NULL
      `,
      documentId
    )) as Array<{ embeddedCount: number }>;
    expect(Number(embeddedRows[0]?.embeddedCount ?? 0)).toBe(chunks.length);

    // Extractor-gate response: supported requirement values with supporting chunk IDs.
    generateEvidenceSufficiencyMock.mockImplementation(
      async (params: { question: string; snippets: Array<{ chunkId: string }> }) => {
        const question = params.question.toLowerCase();

        if (question.includes("least privilege")) {
          return {
            requirements: ["Production access restriction", "Least privilege"],
            extracted: [
              {
                requirement: "Production access restriction",
                value: "Production access is restricted to authorized personnel.",
                supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
              },
              {
                requirement: "Least privilege",
                value: "Access is granted using least privilege principles.",
                supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
              }
            ],
            overall: "FOUND"
          };
        }

        if (question.includes("minimum tls")) {
          return {
            requirements: ["Minimum TLS version", "mTLS for internal services"],
            extracted: [
              {
                requirement: "Minimum TLS version",
                value: "Minimum TLS version is 1.2 (TLS 1.2+).",
                supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
              },
              {
                requirement: "mTLS for internal services",
                value: "Internal services use mTLS where supported.",
                supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
              }
            ],
            overall: "FOUND"
          };
        }

        return {
          requirements: ["At-rest algorithm", "Key management system"],
          extracted: [
            {
              requirement: "At-rest algorithm",
              value: "Data at rest is encrypted using AES-256.",
              supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
            },
            {
              requirement: "Key management system",
              value: "Encryption keys are managed through KMS.",
              supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
            }
          ],
          overall: "FOUND"
        };
      }
    );
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "unused",
      citations: [],
      confidence: "low",
      needsReview: true
    });

    if (!activeOrgId) {
      throw new Error("Expected active organization to be initialized.");
    }
    const checks = [
      {
        question: "Is production access restricted to authorized personnel and granted using least privilege principles?",
        expectedRelevantChunkId: leastPrivilegeChunkId as string
      },
      {
        question: "Is traffic encrypted in transit with minimum TLS 1.2 and is mTLS used for internal services?",
        expectedRelevantChunkId: tlsChunkId as string
      },
      {
        question: "Is data encrypted at rest using AES-256 with KMS-managed keys?",
        expectedRelevantChunkId: atRestChunkId as string
      }
    ];

    for (const check of checks) {
      const result = await answerQuestion({
        orgId: activeOrgId,
        questionText: check.question,
        debug: true
      });

      const rerankedTopNIds = result.debug?.rerankedTopN.map((chunk) => chunk.chunkId) ?? [];
      expect(rerankedTopNIds).toContain(check.expectedRelevantChunkId);
      expect(result.debug?.sufficiency?.overall).toBe("FOUND");
      expect(result.answer).not.toBe(NOT_FOUND_TEXT);
      expect(result.citations.length).toBeGreaterThan(0);
    }
  });
});
