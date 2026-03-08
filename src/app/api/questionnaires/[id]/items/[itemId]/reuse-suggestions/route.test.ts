import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openai", () => ({
  createEmbedding: vi.fn()
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: vi.fn()
}));

import { prisma } from "@/lib/prisma";
import { createEmbedding } from "@/lib/openai";
import { getRequestContext } from "@/lib/requestContext";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { embeddingToVectorLiteral } from "@/lib/retrieval";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { GET as reuseSuggestionsRoute } from "@/app/api/questionnaires/[id]/items/[itemId]/reuse-suggestions/route";

const TEST_ORG_PREFIX = "vitest-reuse-suggestions-api-route-";
const createEmbeddingMock = vi.mocked(createEmbedding);
const getRequestContextMock = vi.mocked(getRequestContext);

function sparseEmbedding(primaryIndex: number, secondaryIndex?: number, secondaryWeight = 0.25): number[] {
  const vector = new Array(1536).fill(0);
  vector[primaryIndex] = 1;
  if (secondaryIndex !== undefined) {
    vector[secondaryIndex] = secondaryWeight;
  }
  return vector;
}

async function cleanupTestOrganizations() {
  const organizations = await prisma.organization.findMany({
    where: {
      name: {
        startsWith: TEST_ORG_PREFIX
      }
    },
    select: {
      id: true
    }
  });

  if (organizations.length === 0) {
    return;
  }

  const organizationIds = organizations.map((organization) => organization.id);
  const questionnaires = await prisma.questionnaire.findMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    },
    select: {
      id: true
    }
  });
  const questionnaireIds = questionnaires.map((questionnaire) => questionnaire.id);
  const questions = await prisma.question.findMany({
    where: {
      questionnaireId: {
        in: questionnaireIds
      }
    },
    select: {
      id: true
    }
  });
  const questionIds = questions.map((question) => question.id);
  const approvedAnswers = await prisma.approvedAnswer.findMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    },
    select: {
      id: true
    }
  });
  const approvedAnswerIds = approvedAnswers.map((approvedAnswer) => approvedAnswer.id);

  await prisma.approvedAnswerEvidence.deleteMany({
    where: {
      approvedAnswerId: {
        in: approvedAnswerIds
      }
    }
  });

  await prisma.approvedAnswer.deleteMany({
    where: {
      id: {
        in: approvedAnswerIds
      }
    }
  });

  await prisma.question.deleteMany({
    where: {
      id: {
        in: questionIds
      }
    }
  });

  await prisma.questionnaire.deleteMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    }
  });

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

  await prisma.membership.deleteMany({
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

async function attachQuestionEmbedding(approvedAnswerId: string, embedding: number[]) {
  await prisma.$executeRawUnsafe(
    `
      UPDATE "ApprovedAnswer"
      SET "questionEmbedding" = $1::vector(1536)
      WHERE "id" = $2
    `,
    embeddingToVectorLiteral(embedding),
    approvedAnswerId
  );
}

async function seedApprovedAnswer(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
  answerText: string;
  chunkText: string;
  embedding: number[];
}) {
  const metadata = buildQuestionTextMetadata(params.questionText);
  const suffix = randomUUID();
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `reuse-suggestion-route-${suffix}`,
      originalName: `reuse-suggestion-route-${suffix}.txt`,
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      content: params.chunkText,
      evidenceFingerprint: computeEvidenceFingerprint(params.chunkText)
    }
  });

  const question = await prisma.question.create({
    data: {
      questionnaireId: params.questionnaireId,
      rowIndex: params.rowIndex,
      sourceRow: {
        Question: params.questionText
      },
      text: params.questionText,
      answer: params.answerText,
      citations: [
        {
          chunkId: chunk.id,
          docName: document.name,
          quotedSnippet: params.chunkText
        }
      ]
    }
  });

  const approvedAnswer = await prisma.approvedAnswer.create({
    data: {
      organizationId: params.organizationId,
      questionId: question.id,
      normalizedQuestionText: metadata.normalizedQuestionText,
      questionTextHash: metadata.questionTextHash,
      answerText: params.answerText,
      citationChunkIds: [chunk.id],
      source: "GENERATED"
    }
  });

  await attachQuestionEmbedding(approvedAnswer.id, params.embedding);
  await syncApprovedAnswerEvidenceSnapshots({
    db: prisma,
    organizationId: params.organizationId,
    approvedAnswerId: approvedAnswer.id,
    citationChunkIds: [chunk.id]
  });

  return {
    approvedAnswerId: approvedAnswer.id
  };
}

describe.sequential("GET /api/questionnaires/[id]/items/[itemId]/reuse-suggestions", () => {
  beforeEach(() => {
    createEmbeddingMock.mockReset();
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns up to three suggestions sorted by similarity descending", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `reuse-suggestions-route-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `reuse-suggestion-route-q-${randomUUID()}`,
        totalCount: 5
      }
    });

    const targetQuestion = await prisma.question.create({
      data: {
        questionnaireId: questionnaire.id,
        rowIndex: 0,
        sourceRow: {
          Question: "What TLS version is required for inbound traffic?"
        },
        text: "What TLS version is required for inbound traffic?",
        citations: []
      }
    });

    const exact = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "What minimum TLS version is required?",
      answerText: "TLS 1.2 or higher is required.",
      chunkText: "TLS 1.2 or higher is required for all external traffic.",
      embedding: sparseEmbedding(7)
    });

    const nearA = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 2,
      questionText: "Which TLS baseline applies to customer traffic?",
      answerText: "Customer traffic requires TLS 1.2 or higher.",
      chunkText: "Customer traffic requires TLS 1.2 or higher in production.",
      embedding: sparseEmbedding(7, 11, 0.2)
    });

    const nearB = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 3,
      questionText: "Is TLS 1.2 enforced externally?",
      answerText: "TLS 1.2 is enforced for external endpoints.",
      chunkText: "TLS 1.2 is enforced for external endpoints and ingress traffic.",
      embedding: sparseEmbedding(7, 12, 0.45)
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 4,
      questionText: "Do you hold FedRAMP Moderate authorization?",
      answerText: "No FedRAMP authorization is currently held.",
      chunkText: "The organization does not hold a FedRAMP authorization.",
      embedding: sparseEmbedding(15)
    });

    createEmbeddingMock.mockResolvedValue(sparseEmbedding(7));

    const response = await reuseSuggestionsRoute(
      new Request("http://localhost/api/questionnaires/reuse/items/target/reuse-suggestions"),
      {
        params: {
          id: questionnaire.id,
          itemId: targetQuestion.id
        }
      }
    );
    const payload = (await response.json()) as {
      suggestions?: Array<{
        approvedAnswerId?: string;
        answerText?: string;
        citationsCount?: number;
        similarity?: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.suggestions).toHaveLength(3);
    expect(payload.suggestions?.map((suggestion) => suggestion.approvedAnswerId)).toEqual([
      exact.approvedAnswerId,
      nearA.approvedAnswerId,
      nearB.approvedAnswerId
    ]);
    expect(payload.suggestions?.every((suggestion) => typeof suggestion.citationsCount === "number")).toBe(true);
  });
});
