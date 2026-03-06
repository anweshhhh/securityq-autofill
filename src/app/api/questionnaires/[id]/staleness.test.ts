import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as stalenessRoute } from "@/app/api/questionnaires/[id]/staleness/route";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";

const {
  getRequestContextMock
} = vi.hoisted(() => ({
  getRequestContextMock: vi.fn()
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock
}));

const TEST_ORG_PREFIX = "vitest-questionnaire-staleness-route-";

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

  await prisma.approvedAnswerEvidence.deleteMany({
    where: {
      approvedAnswer: {
        organizationId: {
          in: organizationIds
        }
      }
    }
  });

  await prisma.approvedAnswer.deleteMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    }
  });

  await prisma.question.deleteMany({
    where: {
      questionnaire: {
        organizationId: {
          in: organizationIds
        }
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

  await prisma.organization.deleteMany({
    where: {
      id: {
        in: organizationIds
      }
    }
  });
}

async function seedApprovedAnswer(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
  answerText: string;
  chunkText: string;
}) {
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `staleness-route-${randomUUID()}`,
      originalName: `staleness-route-${randomUUID()}.txt`,
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

  const metadata = buildQuestionTextMetadata(params.questionText);
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

  await syncApprovedAnswerEvidenceSnapshots({
    db: prisma,
    organizationId: params.organizationId,
    approvedAnswerId: approvedAnswer.id,
    citationChunkIds: [chunk.id]
  });

  return {
    questionId: question.id,
    chunkId: chunk.id
  };
}

describe.sequential("GET /api/questionnaires/[id]/staleness", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns staleCount and staleItems for questionnaire", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `staleness-route-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: "Route stale summary questionnaire"
      }
    });

    const staleQuestion = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Is MFA enabled for admins?",
      answerText: "Yes, MFA is enabled.",
      chunkText: "Multi-factor authentication is required for administrative users."
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Are logs retained for one year?",
      answerText: "Logs are retained for one year.",
      chunkText: "Logs are retained for one year in secure storage."
    });

    const updatedChunkText = "MFA policy now requires only password authentication.";
    await prisma.documentChunk.update({
      where: { id: staleQuestion.chunkId },
      data: {
        content: updatedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(updatedChunkText)
      }
    });

    const response = await stalenessRoute(new Request("http://localhost/api/questionnaires/route"), {
      params: { id: questionnaire.id }
    });
    const payload = (await response.json()) as {
      staleCount?: number;
      staleItems?: Array<{ questionnaireItemId?: string; rowIndex?: number | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.staleCount).toBe(1);
    expect(payload.staleItems).toEqual([{ questionnaireItemId: staleQuestion.questionId, rowIndex: 0 }]);
  });

  it("returns zero stale items for fresh approvals", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}-fresh`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `staleness-route-user-${Date.now()}-fresh`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: "Route no stale summary questionnaire"
      }
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you enforce TLS 1.2?",
      answerText: "TLS 1.2 is enforced.",
      chunkText: "TLS 1.2 is required for all external connections."
    });

    const response = await stalenessRoute(new Request("http://localhost/api/questionnaires/route"), {
      params: { id: questionnaire.id }
    });
    const payload = (await response.json()) as {
      staleCount?: number;
      staleItems?: Array<{ questionnaireItemId?: string; rowIndex?: number | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.staleCount).toBe(0);
    expect(payload.staleItems).toEqual([]);
  });
});
