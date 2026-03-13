import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { getTrustQueueSessionForOrg } from "@/server/trustQueue/getTrustQueueSession";

const TEST_ORG_PREFIX = "vitest-trust-queue-session-";

async function cleanupTrustQueueSessionData() {
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

  await prisma.questionHistoryEvent.deleteMany({
    where: {
      questionId: {
        in: questionIds
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

async function createNeedsReviewQuestion(params: {
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
}) {
  return prisma.question.create({
    data: {
      questionnaireId: params.questionnaireId,
      rowIndex: params.rowIndex,
      sourceRow: {
        Question: params.questionText
      },
      text: params.questionText,
      citations: [],
      reviewStatus: "NEEDS_REVIEW"
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
}) {
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `trust-queue-session-doc-${randomUUID()}`,
      originalName: `trust-queue-session-doc-${randomUUID()}.txt`,
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
      reviewStatus: "APPROVED"
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

describe.sequential("getTrustQueueSessionForOrg", () => {
  afterEach(async () => {
    await cleanupTrustQueueSessionData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns the first sorted actionable row", async () => {
    const organization = await createOrganization("first");
    const blockedQuestionnaire = await createQuestionnaire(organization.id, "Blocked queue");
    const needsReviewQuestionnaire = await createQuestionnaire(organization.id, "Needs review queue");

    const stale = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you archive logs?",
      answerText: "Logs are archived.",
      chunkText: "Logs are archived for one year."
    });

    await createNeedsReviewQuestion({
      questionnaireId: needsReviewQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you review access quarterly?"
    });

    const driftedText = `Trust queue session drift ${randomUUID()}`;
    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: driftedText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedText)
      }
    });

    const session = await getTrustQueueSessionForOrg({ orgId: organization.id });

    expect(session.firstItem).toEqual({
      questionnaireId: blockedQuestionnaire.id,
      itemId: stale.questionId,
      priority: "P1",
      rowFilter: "stale"
    });
    expect(session.totalCount).toBe(2);
  });

  it("returns current and next items from the sorted queue order", async () => {
    const organization = await createOrganization("next");
    const blockedQuestionnaire = await createQuestionnaire(organization.id, "Blocked queue");
    const openQuestionnaire = await createQuestionnaire(organization.id, "Open queue");

    const stale = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you encrypt backups?",
      answerText: "Backups are encrypted.",
      chunkText: "Backups are encrypted before storage."
    });

    const p2 = await createNeedsReviewQuestion({
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 1,
      questionText: "Do you review key rotations?"
    });

    await createNeedsReviewQuestion({
      questionnaireId: openQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you review router changes?"
    });

    const driftedText = `Trust queue next drift ${randomUUID()}`;
    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: driftedText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedText)
      }
    });

    const session = await getTrustQueueSessionForOrg({
      orgId: organization.id
    }, {
      currentItemId: p2.id
    });

    expect(session.current).toEqual({
      questionnaireId: blockedQuestionnaire.id,
      itemId: p2.id,
      priority: "P2",
      rowFilter: "needs-review"
    });
    expect(session.next).toEqual({
      questionnaireId: openQuestionnaire.id,
      itemId: expect.any(String),
      priority: "P3",
      rowFilter: "needs-review"
    });
  });

  it("returns null next when the current item is the last row", async () => {
    const organization = await createOrganization("end");
    const questionnaire = await createQuestionnaire(organization.id, "Needs review queue");
    const question = await createNeedsReviewQuestion({
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you test restores?"
    });

    const session = await getTrustQueueSessionForOrg(
      { orgId: organization.id },
      {
        currentItemId: question.id
      }
    );

    expect(session.current).toEqual({
      questionnaireId: questionnaire.id,
      itemId: question.id,
      priority: "P3",
      rowFilter: "needs-review"
    });
    expect(session.next).toBeNull();
  });

  it("respects trust queue filter and questionnaire-name query scoping", async () => {
    const organization = await createOrganization("scope");
    const matchedQuestionnaire = await createQuestionnaire(organization.id, "Vendor Alpha Review");
    const otherQuestionnaire = await createQuestionnaire(organization.id, "Vendor Beta Review");

    const matched = await createNeedsReviewQuestion({
      questionnaireId: matchedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Does Alpha support SAML?"
    });

    await createNeedsReviewQuestion({
      questionnaireId: otherQuestionnaire.id,
      rowIndex: 0,
      questionText: "Does Beta support SAML?"
    });

    const session = await getTrustQueueSessionForOrg(
      { orgId: organization.id },
      {
        query: "alpha",
        filter: "needs-review",
        currentItemId: matched.id
      }
    );

    expect(session.totalCount).toBe(1);
    expect(session.firstItem).toEqual({
      questionnaireId: matchedQuestionnaire.id,
      itemId: matched.id,
      priority: "P3",
      rowFilter: "needs-review"
    });
    expect(session.current?.itemId).toBe(matched.id);
    expect(session.next).toBeNull();
  });

  it("scopes the session to the active organization", async () => {
    const orgA = await createOrganization("org-a");
    const orgB = await createOrganization("org-b");
    const questionnaireA = await createQuestionnaire(orgA.id, "Org A queue");
    const questionnaireB = await createQuestionnaire(orgB.id, "Org B queue");

    const visible = await createNeedsReviewQuestion({
      questionnaireId: questionnaireA.id,
      rowIndex: 0,
      questionText: "Does Org A require SSO?"
    });

    await createNeedsReviewQuestion({
      questionnaireId: questionnaireB.id,
      rowIndex: 0,
      questionText: "Does Org B require SSO?"
    });

    const session = await getTrustQueueSessionForOrg({ orgId: orgA.id });

    expect(session.totalCount).toBe(1);
    expect(session.firstItem).toEqual({
      questionnaireId: questionnaireA.id,
      itemId: visible.id,
      priority: "P3",
      rowFilter: "needs-review"
    });
  });
});
