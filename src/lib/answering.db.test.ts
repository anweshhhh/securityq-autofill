import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";

const { createEmbeddingMock, generateGroundedAnswerMock } = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn()
}));

vi.mock("./openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock
}));

import { answerQuestionWithEvidence } from "./answering";

const TEST_ORG_PREFIX = "vitest-ir-evidence-";
const EMBEDDING_LITERAL = `[${new Array(1536).fill(0.01).join(",")}]`;

async function cleanupTestOrganizations() {
  const organizations = await prisma.organization.findMany({
    where: { name: { startsWith: TEST_ORG_PREFIX } },
    select: { id: true }
  });

  if (organizations.length === 0) {
    return;
  }

  const organizationIds = organizations.map((organization) => organization.id);

  await prisma.documentChunk.deleteMany({
    where: {
      document: {
        organizationId: {
          in: organizationIds
        }
      }
    }
  });

  await prisma.document.deleteMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    }
  });

  await prisma.organization.deleteMany({
    where: {
      id: {
        in: organizationIds
      }
    }
  });
}

async function seedDocumentChunk(organizationId: string, content: string) {
  const document = await prisma.document.create({
    data: {
      organizationId,
      name: `ir-doc-${Date.now()}`,
      originalName: `ir-doc-${Date.now()}.txt`,
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      content
    }
  });

  await prisma.$executeRawUnsafe(
    `UPDATE "DocumentChunk" SET "embedding" = $1::vector(1536) WHERE "id" = $2`,
    EMBEDDING_LITERAL,
    chunk.id
  );

  return chunk;
}

describe.sequential("answering DB-backed evidence behavior", () => {
  beforeEach(async () => {
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    await cleanupTestOrganizations();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns a cited FOUND answer for incident response evidence", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });

    const chunk = await seedDocumentChunk(
      organization.id,
      "The incident response process is documented and tested. " +
        "Incidents are classified into severity levels (SEV-1 through SEV-4) " +
        "with defined escalation timelines and on-call ownership."
    );

    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Incident response uses documented severity levels and escalation timelines.",
      citationChunkIds: [chunk.id],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: organization.id,
      question: "Describe your incident response process and severity levels."
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);

    const citationText = result.citations.map((citation) => citation.quotedSnippet).join(" ").toLowerCase();
    expect(citationText).toContain("incident response");
    expect(citationText).toContain("severity levels");
  });
});
