import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createApprovedAnswerRoute } from "@/app/api/approved-answers/route";
import { PATCH as updateApprovedAnswerRoute } from "@/app/api/approved-answers/[id]/route";
import { GET as approvalHistoryRoute } from "@/app/api/questionnaires/[id]/items/[itemId]/approval-history/route";
import { POST as draftRoute } from "@/app/api/questions/[id]/draft/route";
import { prisma } from "@/lib/prisma";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";

const { getRequestContextMock } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn()
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock
}));

const TEST_ORG_PREFIX = "vitest-approval-history-route-";

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

  await prisma.questionHistoryEvent.deleteMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    }
  });

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
      id: {
        in: questionnaireIds
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
  const chunkText = "Administrative access requires MFA.";
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `approval-history-doc-${suffix}`,
      originalName: `approval-history-doc-${suffix}.txt`,
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

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
    questionId: question.id,
    chunkId: chunk.id,
    chunkText
  };
}

async function approveQuestion(params: {
  questionId: string;
  answerText: string;
  citationChunkIds: string[];
}) {
  const response = await createApprovedAnswerRoute(
    new Request("http://localhost/api/approved-answers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        questionId: params.questionId,
        answerText: params.answerText,
        citationChunkIds: params.citationChunkIds
      })
    })
  );
  const payload = (await response.json()) as {
    approvedAnswer?: {
      id?: string;
    };
  };

  expect(response.status).toBe(200);
  expect(typeof payload.approvedAnswer?.id).toBe("string");

  return payload.approvedAnswer?.id as string;
}

describe.sequential("GET /api/questionnaires/[id]/items/[itemId]/approval-history", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns draft update followed by approved history", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    getRequestContextMock.mockResolvedValue({
      userId: `approval-history-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-history-q-${randomUUID()}`
      }
    });
    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you secure admin access?"
    });

    const draftResponse = await draftRoute(
      new Request("http://localhost/api/questions/question/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: "Administrative access requires MFA.",
          citationChunkIds: [seeded.chunkId]
        })
      }),
      {
        params: {
          id: seeded.questionId
        }
      }
    );
    expect(draftResponse.status).toBe(200);

    await approveQuestion({
      questionId: seeded.questionId,
      answerText: "Administrative access requires MFA.",
      citationChunkIds: [seeded.chunkId]
    });

    const response = await approvalHistoryRoute(new Request("http://localhost/api/questionnaires/item/approval-history"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      hasItem?: boolean;
      history?: Array<{ type?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.hasItem).toBe(true);
    expect(payload.history?.map((event) => event.type)).toEqual(["DRAFT_UPDATED", "APPROVED"]);
  });

  it("returns suggestion applied followed by approved history", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    getRequestContextMock.mockResolvedValue({
      userId: `approval-history-suggestion-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-history-q-${randomUUID()}`
      }
    });
    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you require MFA for VPN?"
    });

    const suggestionResponse = await draftRoute(
      new Request("http://localhost/api/questions/question/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: "Administrative access requires MFA.",
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
    expect(suggestionResponse.status).toBe(200);

    await approveQuestion({
      questionId: seeded.questionId,
      answerText: "Administrative access requires MFA.",
      citationChunkIds: [seeded.chunkId]
    });

    const response = await approvalHistoryRoute(new Request("http://localhost/api/questionnaires/item/approval-history"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      history?: Array<{ type?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.history?.map((event) => event.type)).toEqual(["SUGGESTION_APPLIED", "APPROVED"]);
  }, 15000);

  it("returns re-approval history after an approved answer is refreshed", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    getRequestContextMock.mockResolvedValue({
      userId: `approval-history-reapprove-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-history-q-${randomUUID()}`
      }
    });
    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you secure admin access?"
    });

    const approvedAnswerId = await approveQuestion({
      questionId: seeded.questionId,
      answerText: "Administrative access requires MFA.",
      citationChunkIds: [seeded.chunkId]
    });

    const driftedChunkText = "Administrative access requires MFA and network restrictions.";
    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: driftedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedChunkText)
      }
    });

    const patchResponse = await updateApprovedAnswerRoute(
      new Request(`http://localhost/api/approved-answers/${approvedAnswerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: "Administrative access requires MFA and network restrictions.",
          citationChunkIds: [seeded.chunkId]
        })
      }),
      {
        params: {
          id: approvedAnswerId
        }
      }
    );
    expect(patchResponse.status).toBe(200);

    const response = await approvalHistoryRoute(new Request("http://localhost/api/questionnaires/item/approval-history"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      history?: Array<{ type?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.history?.map((event) => event.type)).toEqual(["APPROVED", "REAPPROVED"]);
  }, 15000);

  it("returns a current stale marker for a drifted approved item", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    getRequestContextMock.mockResolvedValue({
      userId: `approval-history-stale-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-history-q-${randomUUID()}`
      }
    });
    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you secure backups?"
    });

    await approveQuestion({
      questionId: seeded.questionId,
      answerText: "Administrative access requires MFA.",
      citationChunkIds: [seeded.chunkId]
    });

    const driftedChunkText = "Administrative access requires MFA and just-in-time elevation.";
    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: driftedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedChunkText)
      }
    });

    const response = await approvalHistoryRoute(new Request("http://localhost/api/questionnaires/item/approval-history"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      history?: Array<{ type?: string; occurredAt?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.history?.map((event) => event.type)).toEqual(["APPROVED", "BECAME_STALE"]);
    expect(typeof payload.history?.[1]?.occurredAt).toBe("string");
  }, 15000);

  it("returns an empty history for an item with no history events", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    getRequestContextMock.mockResolvedValue({
      userId: `approval-history-empty-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-history-q-${randomUUID()}`
      }
    });
    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you sign audit logs?"
    });

    const response = await approvalHistoryRoute(new Request("http://localhost/api/questionnaires/item/approval-history"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      hasItem?: boolean;
      history?: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.hasItem).toBe(true);
    expect(payload.history).toEqual([]);
  });

  it("returns 404 for out-of-org access", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    const otherOrganization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}-other`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `approval-history-other-${Date.now()}`,
      orgId: otherOrganization.id,
      role: MembershipRole.REVIEWER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-history-q-${randomUUID()}`
      }
    });
    const seeded = await seedQuestionWithChunk({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are admin sessions protected?"
    });

    const response = await approvalHistoryRoute(new Request("http://localhost/api/questionnaires/item/approval-history"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("NOT_FOUND");
  });
});
