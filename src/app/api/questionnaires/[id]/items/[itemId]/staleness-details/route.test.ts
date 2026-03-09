import { randomUUID } from "node:crypto";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as stalenessDetailsRoute } from "@/app/api/questionnaires/[id]/items/[itemId]/staleness-details/route";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";

const { getRequestContextMock } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn()
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock
}));

const TEST_ORG_PREFIX = "vitest-staleness-details-route-";

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
      name: `staleness-details-${randomUUID()}`,
      originalName: `staleness-details-${randomUUID()}.txt`,
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
    approvedAnswerId: approvedAnswer.id,
    chunkId: chunk.id,
    documentId: document.id
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

describe.sequential("GET /api/questionnaires/[id]/items/[itemId]/staleness-details", () => {
  beforeEach(() => {
    getRequestContextMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("classifies missing evidence when the cited chunk is no longer available in the current org", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });
    const movedEvidenceOrg = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}-moved`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `staleness-details-user-${Date.now()}`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `staleness-details-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you encrypt backups?",
      answerText: "Backups are encrypted using AES-256.",
      chunkText: "Backups are encrypted using AES-256 before being stored."
    });

    await prisma.document.update({
      where: {
        id: seeded.documentId
      },
      data: {
        organizationId: movedEvidenceOrg.id
      }
    });

    const response = await stalenessDetailsRoute(new Request("http://localhost/api/questionnaires/item/staleness-details"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      isStale?: boolean;
      details?: {
        affectedCitationsCount?: number;
        changedCount?: number;
        missingCount?: number;
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.isStale).toBe(true);
    expect(payload.details).toMatchObject({
      affectedCitationsCount: 1,
      changedCount: 0,
      missingCount: 1
    });
  });

  it("classifies fingerprint mismatch when cited evidence drifts", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `staleness-details-user-${Date.now()}-changed`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `staleness-details-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "What is your privileged access policy?",
      answerText: "Privileged access requires MFA.",
      chunkText: "Privileged access requires MFA and quarterly review."
    });

    const driftedChunkText = "Privileged access requires review, but MFA is not specified.";
    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: driftedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedChunkText)
      }
    });

    const response = await stalenessDetailsRoute(new Request("http://localhost/api/questionnaires/item/staleness-details"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      isStale?: boolean;
      details?: {
        affectedCitationsCount?: number;
        changedCount?: number;
        missingCount?: number;
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.isStale).toBe(true);
    expect(payload.details).toMatchObject({
      affectedCitationsCount: 1,
      changedCount: 1,
      missingCount: 0
    });
  });

  it("returns a fresh result when approval evidence is unchanged", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `staleness-details-user-${Date.now()}-fresh`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `staleness-details-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are secrets rotated?",
      answerText: "Secrets are rotated every 90 days.",
      chunkText: "Secrets are rotated every 90 days through the centralized secret manager."
    });

    const response = await stalenessDetailsRoute(new Request("http://localhost/api/questionnaires/item/staleness-details"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      isStale?: boolean;
      details?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      isStale: false,
      details: null
    });
  });

  it("returns a non-stale result when the item has no approved answer", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    getRequestContextMock.mockResolvedValue({
      userId: `staleness-details-user-${Date.now()}-draft`,
      orgId: organization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `staleness-details-q-${randomUUID()}`
      }
    });

    const question = await seedQuestionWithoutApproval({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you maintain a vendor inventory?"
    });

    const response = await stalenessDetailsRoute(new Request("http://localhost/api/questionnaires/item/staleness-details"), {
      params: {
        id: questionnaire.id,
        itemId: question.questionId
      }
    });
    const payload = (await response.json()) as {
      isStale?: boolean;
      details?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      isStale: false,
      details: null
    });
  });

  it("returns 404 for out-of-org questionnaire items", async () => {
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
      userId: `staleness-details-user-${Date.now()}-other`,
      orgId: otherOrganization.id,
      role: MembershipRole.OWNER
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `staleness-details-q-${randomUUID()}`
      }
    });

    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are incidents triaged?",
      answerText: "Incidents are triaged by severity.",
      chunkText: "Incidents are triaged by severity and pager rotation."
    });

    const response = await stalenessDetailsRoute(new Request("http://localhost/api/questionnaires/item/staleness-details"), {
      params: {
        id: questionnaire.id,
        itemId: seeded.questionId
      }
    });
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("NOT_FOUND");
  });
});
