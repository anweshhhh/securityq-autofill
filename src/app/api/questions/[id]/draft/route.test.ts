import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getRequestContextMock } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn()
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock
}));

import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { POST as draftRoute } from "@/app/api/questions/[id]/draft/route";

const TEST_ORG_PREFIX = "vitest-question-draft-route-";

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

async function seedQuestionWithChunk(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
}) {
  const suffix = randomUUID();
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `draft-route-doc-${suffix}`,
      originalName: `draft-route-doc-${suffix}.txt`,
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const chunkText = "TLS 1.2 or higher is required for external connections.";
  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      content: chunkText,
      evidenceFingerprint: computeEvidenceFingerprint(chunkText)
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
      citations: []
    }
  });

  return {
    chunkId: chunk.id,
    docName: document.name,
    questionId: question.id
  };
}

describe.sequential("POST /api/questions/[id]/draft", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves a suggested answer into the draft state and marks it needs review", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `draft-route-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `draft-route-q-${randomUUID()}`,
        totalCount: 1
      }
    });

    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "What minimum TLS version is required?"
    });

    const response = await draftRoute(
      new Request("http://localhost/api/questions/question/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: "TLS 1.2 or higher is required.",
          citationChunkIds: [seeded.chunkId],
          draftSource: "SUGGESTION_APPLY"
        })
      }),
      {
        params: {
          id: seeded.questionId
        }
      }
    );
    const payload = (await response.json()) as {
      question?: {
        answer?: string;
        citations?: Array<{ chunkId?: string }>;
        reviewStatus?: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.question?.answer).toBe("TLS 1.2 or higher is required.");
    expect(payload.question?.reviewStatus).toBe("NEEDS_REVIEW");
    expect(payload.question?.citations).toEqual([
      expect.objectContaining({
        chunkId: seeded.chunkId
      })
    ]);

    const persisted = await prisma.question.findUnique({
      where: {
        id: seeded.questionId
      },
      select: {
        draftSuggestionApplied: true
      }
    });

    expect(persisted?.draftSuggestionApplied).toBe(true);
  });

  it("blocks applying a suggestion to an already approved question", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `draft-route-user-${Date.now()}-approved`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `draft-route-q-${randomUUID()}`,
        totalCount: 1
      }
    });

    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you require MFA for administrators?"
    });

    const metadata = buildQuestionTextMetadata("Do you require MFA for administrators?");
    await prisma.approvedAnswer.create({
      data: {
        organizationId: organization.id,
        questionId: seeded.questionId,
        normalizedQuestionText: metadata.normalizedQuestionText,
        questionTextHash: metadata.questionTextHash,
        answerText: "Administrators are required to use MFA.",
        citationChunkIds: [seeded.chunkId],
        source: "GENERATED"
      }
    });

    const response = await draftRoute(
      new Request("http://localhost/api/questions/question/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: "Administrators are required to use MFA.",
          citationChunkIds: [seeded.chunkId]
        })
      }),
      {
        params: {
          id: seeded.questionId
        }
      }
    );
    const payload = (await response.json()) as {
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("QUESTION_ALREADY_APPROVED");
  });
});
