import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as approvalTraceRoute } from "@/app/api/questionnaires/[id]/items/[itemId]/approval-trace/route";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";

const { getRequestContextMock } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn()
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock
}));

const TEST_ORG_PREFIX = "vitest-approval-trace-route-";

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

async function seedApprovedQuestion(params: {
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
      name: `approval-trace-doc-${suffix}`,
      originalName: `approval-trace-doc-${suffix}.txt`,
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
    questionId: question.id,
    approvedAnswerId: approvedAnswer.id,
    chunkId: chunk.id
  };
}

async function seedQuestionWithoutApproval(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
}) {
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
    questionId: question.id
  };
}

describe.sequential("GET /api/questionnaires/[id]/items/[itemId]/approval-trace", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns approval provenance for a fresh approved item", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `approval-trace-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-trace-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are admin sessions protected?",
      answerText: "Administrative sessions require MFA.",
      chunkText: "Administrative sessions require MFA."
    });

    const response = await approvalTraceRoute(new Request("http://localhost/api/questionnaires/item/approval-trace"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      hasApprovedAnswer?: boolean;
      trace?: {
        approvedAt?: string;
        freshness?: string;
        snapshottedCitationsCount?: number;
        reusedFromApprovedAnswer?: boolean;
        suggestionAssisted?: boolean;
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.hasApprovedAnswer).toBe(true);
    expect(payload.trace).toMatchObject({
      freshness: "FRESH",
      snapshottedCitationsCount: 1,
      reusedFromApprovedAnswer: false,
      suggestionAssisted: false
    });
    expect(typeof payload.trace?.approvedAt).toBe("string");
    expect(Number.isNaN(Date.parse(payload.trace?.approvedAt ?? ""))).toBe(false);
  });

  it("returns STALE freshness when approved evidence drifts", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `approval-trace-stale-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-trace-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you secure backups?",
      answerText: "Backups are encrypted at rest.",
      chunkText: "Backups are encrypted at rest."
    });

    const updatedChunkText = "Backups are encrypted at rest and in transit.";
    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: updatedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(updatedChunkText)
      }
    });

    const response = await approvalTraceRoute(new Request("http://localhost/api/questionnaires/item/approval-trace"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      trace?: {
        freshness?: string;
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.trace?.freshness).toBe("STALE");
  });

  it("returns reused provenance when the approved item originated from an approved-answer reuse", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `approval-trace-reuse-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-trace-q-${randomUUID()}`
      }
    });

    const source = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you require SSO?",
      answerText: "SSO is required for workforce identities.",
      chunkText: "SSO is required for workforce identities."
    });

    const reused = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Is SSO required for employees?",
      answerText: "SSO is required for workforce identities.",
      chunkText: "SSO is required for workforce identities.",
      reusedFromApprovedAnswerId: source.approvedAnswerId
    });

    const response = await approvalTraceRoute(new Request("http://localhost/api/questionnaires/item/approval-trace"), {
      params: {
        id: questionnaire.id,
        itemId: reused.questionId
      }
    });
    const payload = (await response.json()) as {
      trace?: {
        reusedFromApprovedAnswer?: boolean;
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.trace?.reusedFromApprovedAnswer).toBe(true);
  });

  it("returns suggestion-assisted provenance when the approved draft came from Apply suggestion", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `approval-trace-suggestion-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-trace-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you protect VPN access?",
      answerText: "VPN access requires MFA.",
      chunkText: "VPN access requires MFA.",
      draftSuggestionApplied: true
    });

    const response = await approvalTraceRoute(new Request("http://localhost/api/questionnaires/item/approval-trace"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      trace?: {
        suggestionAssisted?: boolean;
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.trace?.suggestionAssisted).toBe(true);
  });

  it("returns null trace for an item with no approved answer", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `approval-trace-draft-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-trace-q-${randomUUID()}`
      }
    });

    const seeded = await seedQuestionWithoutApproval({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you sign logs?"
    });

    const response = await approvalTraceRoute(new Request("http://localhost/api/questionnaires/item/approval-trace"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      hasApprovedAnswer?: boolean;
      trace?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload.hasApprovedAnswer).toBe(false);
    expect(payload.trace).toBeNull();
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
      userId: `approval-trace-other-org-${Date.now()}`,
      orgId: otherOrganization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `approval-trace-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you encrypt database backups?",
      answerText: "Database backups are encrypted.",
      chunkText: "Database backups are encrypted."
    });

    const response = await approvalTraceRoute(new Request("http://localhost/api/questionnaires/item/approval-trace"), {
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
