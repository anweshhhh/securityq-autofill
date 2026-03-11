import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as approvedAnswerRoute } from "@/app/api/approved-answers/[id]/route";
import { prisma } from "@/lib/prisma";
import { RequestContextError } from "@/lib/requestContext";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";

const { getRequestContextMock } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn()
}));

vi.mock("@/lib/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/requestContext")>();
  return {
    ...actual,
    getRequestContext: getRequestContextMock
  };
});

const TEST_ORG_PREFIX = "vitest-approved-answer-detail-route-";

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
      questionId: {
        in: questionIds
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

async function createOrganization(nameSuffix: string) {
  return prisma.organization.create({
    data: {
      name: `${TEST_ORG_PREFIX}${nameSuffix}-${randomUUID()}`
    }
  });
}

async function createQuestionnaire(organizationId: string, name: string) {
  return prisma.questionnaire.create({
    data: {
      organizationId,
      name,
      totalCount: 1
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
  draftSuggestionApplied?: boolean;
  reusedFromApprovedAnswerId?: string | null;
}) {
  const suffix = randomUUID();
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `approved-answer-route-doc-${suffix}`,
      originalName: `approved-answer-route-doc-${suffix}.txt`,
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
      ],
      reviewStatus: "APPROVED",
      draftSuggestionApplied: params.draftSuggestionApplied ?? false,
      reusedFromApprovedAnswerId: params.reusedFromApprovedAnswerId ?? null
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
    approvedAnswerId: approvedAnswer.id,
    questionId: question.id,
    questionnaireId: params.questionnaireId,
    chunkId: chunk.id
  };
}

describe.sequential("GET /api/approved-answers/[id]", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns detail payload for a same-org approved answer in library mode", async () => {
    const organization = await createOrganization("detail");
    const questionnaire = await createQuestionnaire(organization.id, "Approved answer detail");
    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are backups protected?",
      answerText: "Backups are protected with AES-256 encryption.",
      chunkText: "Backups are protected with AES-256 encryption.",
      draftSuggestionApplied: true,
      reusedFromApprovedAnswerId: `reused-${randomUUID()}`
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswerRoute(
      new Request(`http://localhost/api/approved-answers/${seeded.approvedAnswerId}?detail=library`),
      {
        params: {
          id: seeded.approvedAnswerId
        }
      }
    );

    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      approvedAnswerId: seeded.approvedAnswerId,
      answerText: "Backups are protected with AES-256 encryption.",
      freshness: "FRESH",
      snapshottedCitationsCount: 1,
      reused: true,
      suggestionAssisted: true,
      staleReasonSummary: null,
      sourceQuestionnaireId: questionnaire.id,
      sourceItemId: seeded.questionId
    });
  });

  it("returns stale reason summary in library mode without blocking the response", async () => {
    const organization = await createOrganization("stale");
    const questionnaire = await createQuestionnaire(organization.id, "Approved answer stale detail");
    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How is data encrypted at rest?",
      answerText: "Data is encrypted at rest with AES-256.",
      chunkText: "Data is encrypted at rest with AES-256."
    });

    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: "Data is encrypted at rest with AES-256-GCM.",
        evidenceFingerprint: computeEvidenceFingerprint("Data is encrypted at rest with AES-256-GCM.")
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswerRoute(
      new Request(`http://localhost/api/approved-answers/${seeded.approvedAnswerId}?detail=library`),
      {
        params: {
          id: seeded.approvedAnswerId
        }
      }
    );

    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      approvedAnswerId: seeded.approvedAnswerId,
      freshness: "STALE",
      staleReasonSummary: {
        affectedCitationsCount: 1,
        changedCount: 1,
        missingCount: 0
      }
    });
  });

  it("preserves stale blocking for the default apply payload", async () => {
    const organization = await createOrganization("apply");
    const questionnaire = await createQuestionnaire(organization.id, "Approved answer apply");
    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How is data encrypted in transit?",
      answerText: "Traffic is protected with TLS 1.2 or higher.",
      chunkText: "Traffic is protected with TLS 1.2 or higher."
    });

    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: "Traffic is protected with TLS 1.3.",
        evidenceFingerprint: computeEvidenceFingerprint("Traffic is protected with TLS 1.3.")
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswerRoute(
      new Request(`http://localhost/api/approved-answers/${seeded.approvedAnswerId}`),
      {
        params: {
          id: seeded.approvedAnswerId
        }
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "STALE_APPROVED_ANSWER"
      }
    });
  });

  it("returns not found for out-of-org approved answers in library mode", async () => {
    const orgA = await createOrganization("org-a");
    const orgB = await createOrganization("org-b");
    const questionnaireB = await createQuestionnaire(orgB.id, "Foreign approved answer");
    const seeded = await seedApprovedAnswer({
      organizationId: orgB.id,
      questionnaireId: questionnaireB.id,
      rowIndex: 0,
      questionText: "How is tenant data isolated?",
      answerText: "Tenant data is isolated logically.",
      chunkText: "Tenant data is isolated logically."
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: orgA.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswerRoute(
      new Request(`http://localhost/api/approved-answers/${seeded.approvedAnswerId}?detail=library`),
      {
        params: {
          id: seeded.approvedAnswerId
        }
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND"
      }
    });
  });

  it("returns a JSON unauthorized error when request context is missing", async () => {
    getRequestContextMock.mockRejectedValue(
      new RequestContextError("Authentication required.", {
        code: "UNAUTHORIZED",
        status: 401
      })
    );

    const response = await approvedAnswerRoute(
      new Request("http://localhost/api/approved-answers/answer-id?detail=library"),
      {
        params: {
          id: "answer-id"
        }
      }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required."
      }
    });
  });
});
