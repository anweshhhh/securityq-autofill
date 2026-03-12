import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as approvedAnswersListRoute } from "@/app/api/approved-answers/route";
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

const TEST_ORG_PREFIX = "vitest-approved-answers-list-route-";

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
      name: `approved-answer-picker-doc-${suffix}`,
      originalName: `approved-answer-picker-doc-${suffix}.txt`,
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

describe.sequential("GET /api/approved-answers", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns same-org fresh rows by default", async () => {
    const organization = await createOrganization("default-fresh");
    const otherOrg = await createOrganization("default-fresh-other");
    const questionnaire = await createQuestionnaire(organization.id, "Picker default");
    const otherQuestionnaire = await createQuestionnaire(otherOrg.id, "Other picker default");

    const fresh = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are secrets rotated?",
      answerText: "Secrets are rotated every 90 days.",
      chunkText: "Secrets are rotated every 90 days.",
      draftSuggestionApplied: true
    });

    const stale = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "How is audit logging retained?",
      answerText: "Audit logs are retained for 12 months.",
      chunkText: "Audit logs are retained for 12 months."
    });

    await seedApprovedAnswer({
      organizationId: otherOrg.id,
      questionnaireId: otherQuestionnaire.id,
      rowIndex: 0,
      questionText: "How are secrets rotated?",
      answerText: "This row must not leak.",
      chunkText: "This row must not leak."
    });

    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: "Audit logs are retained for 24 months.",
        evidenceFingerprint: computeEvidenceFingerprint("Audit logs are retained for 24 months.")
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswersListRoute(
      new Request("http://localhost/api/approved-answers")
    );

    const payload = (await response.json()) as {
      rows?: Array<{ approvedAnswerId?: string; freshness?: string; suggestionAssisted?: boolean }>;
      counts?: { total?: number; fresh?: number; stale?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows?.[0]).toMatchObject({
      approvedAnswerId: fresh.approvedAnswerId,
      freshness: "FRESH",
      suggestionAssisted: true
    });
    expect(payload.counts).toEqual({
      total: 1,
      fresh: 1,
      stale: 0
    });
  });

  it("returns stale rows when explicitly requested", async () => {
    const organization = await createOrganization("stale-filter");
    const questionnaire = await createQuestionnaire(organization.id, "Picker stale filter");

    const stale = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How is endpoint posture enforced?",
      answerText: "Endpoint posture is enforced with MDM controls.",
      chunkText: "Endpoint posture is enforced with MDM controls."
    });

    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: "Endpoint posture is enforced with MDM and EDR controls.",
        evidenceFingerprint: computeEvidenceFingerprint(
          "Endpoint posture is enforced with MDM and EDR controls."
        )
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswersListRoute(
      new Request("http://localhost/api/approved-answers?freshness=stale")
    );

    const payload = (await response.json()) as {
      rows?: Array<{ approvedAnswerId?: string; freshness?: string }>;
      counts?: { total?: number; fresh?: number; stale?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows?.[0]).toMatchObject({
      approvedAnswerId: stale.approvedAnswerId,
      freshness: "STALE"
    });
    expect(payload.counts).toEqual({
      total: 1,
      fresh: 0,
      stale: 1
    });
  });

  it("filters rows by search query", async () => {
    const organization = await createOrganization("search");
    const questionnaire = await createQuestionnaire(organization.id, "Picker search");

    const matching = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you review production access?",
      answerText: "Production access is reviewed every quarter.",
      chunkText: "Production access is reviewed every quarter."
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "How do you review vendor access?",
      answerText: "Vendor access is reviewed every six months.",
      chunkText: "Vendor access is reviewed every six months."
    });

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: MembershipRole.VIEWER
    });

    const response = await approvedAnswersListRoute(
      new Request("http://localhost/api/approved-answers?q=production")
    );

    const payload = (await response.json()) as {
      rows?: Array<{ approvedAnswerId?: string }>;
      counts?: { total?: number; fresh?: number; stale?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.rows?.map((row) => row.approvedAnswerId)).toEqual([matching.approvedAnswerId]);
    expect(payload.counts).toEqual({
      total: 1,
      fresh: 1,
      stale: 0
    });
  });

  it("returns a JSON unauthorized error when auth context is missing", async () => {
    getRequestContextMock.mockRejectedValue(
      new RequestContextError("Authentication required.", {
        code: "UNAUTHORIZED",
        status: 401
      })
    );

    const response = await approvedAnswersListRoute(
      new Request("http://localhost/api/approved-answers")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required."
      }
    });
  });

  it("returns a JSON forbidden error when role is below the view contract", async () => {
    const organization = await createOrganization("forbidden");

    getRequestContextMock.mockResolvedValue({
      userId: `user-${randomUUID()}`,
      orgId: organization.id,
      role: "NO_ROLE" as MembershipRole
    });

    const response = await approvedAnswersListRoute(
      new Request("http://localhost/api/approved-answers")
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN_ROLE"
      }
    });
  });
});
