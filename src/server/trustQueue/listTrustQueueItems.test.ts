import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { listTrustQueueItemsForOrg } from "@/server/trustQueue/listTrustQueueItems";

const TEST_ORG_PREFIX = "vitest-trust-queue-";

async function cleanupTrustQueueData() {
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

async function setQuestionUpdatedAt(questionId: string, updatedAt: Date) {
  await prisma.$executeRaw`
    UPDATE "Question"
    SET "updatedAt" = ${updatedAt}
    WHERE "id" = ${questionId}
  `;
}

async function seedApprovedQuestion(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
  answerText: string;
  chunkText: string;
  reviewStatus?: "APPROVED" | "NEEDS_REVIEW";
}) {
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `trust-queue-doc-${randomUUID()}`,
      originalName: `trust-queue-doc-${randomUUID()}.txt`,
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
      reviewStatus: params.reviewStatus ?? "APPROVED"
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
    questionnaireId: params.questionnaireId
  };
}

describe.sequential("listTrustQueueItemsForOrg", () => {
  afterEach(async () => {
    await cleanupTrustQueueData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("scopes rows and summary counts to the active organization", async () => {
    const orgA = await createOrganization("scope-a");
    const orgB = await createOrganization("scope-b");
    const questionnaireA = await createQuestionnaire(orgA.id, "Org A Questionnaire");
    const questionnaireB = await createQuestionnaire(orgB.id, "Org B Questionnaire");

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

    const queue = await listTrustQueueItemsForOrg({ orgId: orgA.id });

    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({
      itemId: visible.id,
      questionnaireId: questionnaireA.id,
      questionnaireName: "Org A Questionnaire",
      reviewStatus: "NEEDS_REVIEW",
      freshness: null,
      isBlockedForApprovedOnlyExport: false,
      priority: "P3"
    });
    expect(queue.summary).toEqual({
      staleApprovalsCount: 0,
      needsReviewCount: 1,
      blockedQuestionnairesCount: 0
    });
    expect(queue.questionnaireGroups).toEqual([
      {
        questionnaireId: questionnaireA.id,
        questionnaireName: "Org A Questionnaire",
        staleCount: 0,
        needsReviewCount: 1,
        blocked: false
      }
    ]);
  });

  it("returns only stale approved items in the stale filter", async () => {
    const organization = await createOrganization("stale-filter");
    const questionnaire = await createQuestionnaire(organization.id, "Stale filter questionnaire");

    const stale = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you require TLS 1.2?",
      answerText: "TLS 1.2 is required.",
      chunkText: "TLS 1.2 is required for all public traffic."
    });

    await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Do you encrypt data at rest?",
      answerText: "Data at rest is encrypted.",
      chunkText: "All production data at rest is encrypted."
    });

    const staleChunkText = "The policy changed and no longer mentions TLS 1.2.";
    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: staleChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(staleChunkText)
      }
    });

    const queue = await listTrustQueueItemsForOrg(
      { orgId: organization.id },
      {
        filter: "STALE"
      }
    );

    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({
      itemId: stale.questionId,
      reviewStatus: "APPROVED",
      freshness: "STALE",
      isBlockedForApprovedOnlyExport: true,
      priority: "P1"
    });
    expect(queue.summary).toEqual({
      staleApprovalsCount: 1,
      needsReviewCount: 0,
      blockedQuestionnairesCount: 1
    });
    expect(queue.questionnaireGroups).toEqual([
      {
        questionnaireId: questionnaire.id,
        questionnaireName: "Stale filter questionnaire",
        staleCount: 1,
        needsReviewCount: 0,
        blocked: true
      }
    ]);
  });

  it("returns only needs-review items in the needs-review filter", async () => {
    const organization = await createOrganization("needs-review-filter");
    const questionnaire = await createQuestionnaire(organization.id, "Needs review questionnaire");

    const needsReview = await createNeedsReviewQuestion({
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you rotate database credentials?"
    });

    await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Do you monitor production errors?",
      answerText: "Production errors are monitored.",
      chunkText: "Production systems are monitored with 24/7 alerting."
    });

    const queue = await listTrustQueueItemsForOrg(
      { orgId: organization.id },
      {
        filter: "NEEDS_REVIEW"
      }
    );

    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({
      itemId: needsReview.id,
      reviewStatus: "NEEDS_REVIEW",
      freshness: null,
      isBlockedForApprovedOnlyExport: false,
      priority: "P3"
    });
    expect(queue.summary).toEqual({
      staleApprovalsCount: 0,
      needsReviewCount: 1,
      blockedQuestionnairesCount: 0
    });
    expect(queue.questionnaireGroups).toEqual([
      {
        questionnaireId: questionnaire.id,
        questionnaireName: "Needs review questionnaire",
        staleCount: 0,
        needsReviewCount: 1,
        blocked: false
      }
    ]);
  });

  it("counts blocked questionnaires from stale approved items", async () => {
    const organization = await createOrganization("blocked-questionnaires");
    const blockedQuestionnaire = await createQuestionnaire(organization.id, "Blocked questionnaire");
    const cleanQuestionnaire = await createQuestionnaire(organization.id, "Clean questionnaire");

    const staleA = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you require phishing training?",
      answerText: "Phishing training is required annually.",
      chunkText: "Employees complete annual phishing awareness training."
    });

    const staleB = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 1,
      questionText: "Do you test backups?",
      answerText: "Backups are tested monthly.",
      chunkText: "Backup recovery tests are performed monthly."
    });

    await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: cleanQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you enforce MFA?",
      answerText: "MFA is enforced.",
      chunkText: "MFA is enforced for all privileged users."
    });

    for (const chunkId of [staleA.chunkId, staleB.chunkId]) {
      const driftedText = `Drifted evidence ${randomUUID()}`;
      await prisma.documentChunk.update({
        where: {
          id: chunkId
        },
        data: {
          content: driftedText,
          evidenceFingerprint: computeEvidenceFingerprint(driftedText)
        }
      });
    }

    const queue = await listTrustQueueItemsForOrg({ orgId: organization.id });

    expect(queue.summary).toEqual({
      staleApprovalsCount: 2,
      needsReviewCount: 0,
      blockedQuestionnairesCount: 1
    });
    expect(queue.rows.map((row) => row.questionnaireId)).toEqual([blockedQuestionnaire.id, blockedQuestionnaire.id]);
    expect(queue.questionnaireGroups).toEqual([
      {
        questionnaireId: blockedQuestionnaire.id,
        questionnaireName: "Blocked questionnaire",
        staleCount: 2,
        needsReviewCount: 0,
        blocked: true
      }
    ]);
  });

  it("filters rows by questionnaire name search", async () => {
    const organization = await createOrganization("search");
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

    const queue = await listTrustQueueItemsForOrg(
      { orgId: organization.id },
      {
        query: "alpha"
      }
    );

    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({
      itemId: matched.id,
      questionnaireName: "Vendor Alpha Review",
      priority: "P3"
    });
    expect(queue.summary).toEqual({
      staleApprovalsCount: 0,
      needsReviewCount: 1,
      blockedQuestionnairesCount: 0
    });
    expect(queue.questionnaireGroups).toEqual([
      {
        questionnaireId: matchedQuestionnaire.id,
        questionnaireName: "Vendor Alpha Review",
        staleCount: 0,
        needsReviewCount: 1,
        blocked: false
      }
    ]);
  });

  it("builds questionnaire groups for blocked and at-risk questionnaires in priority order", async () => {
    const organization = await createOrganization("questionnaire-groups");
    const blockedQuestionnaire = await createQuestionnaire(organization.id, "Vendor Zeta");
    const alsoBlockedQuestionnaire = await createQuestionnaire(organization.id, "Vendor Alpha");
    const needsReviewQuestionnaire = await createQuestionnaire(organization.id, "Vendor Gamma");
    const cleanQuestionnaire = await createQuestionnaire(organization.id, "Vendor Clean");

    const staleSingle = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you sign logs?",
      answerText: "Logs are signed.",
      chunkText: "All audit logs are signed before archival."
    });

    const staleA = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: alsoBlockedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you perform annual pen tests?",
      answerText: "Annual pen tests are performed.",
      chunkText: "Independent annual penetration tests are completed."
    });

    const staleB = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: alsoBlockedQuestionnaire.id,
      rowIndex: 1,
      questionText: "Do you segment production networks?",
      answerText: "Production networks are segmented.",
      chunkText: "Production systems are segmented from corporate endpoints."
    });

    await createNeedsReviewQuestion({
      questionnaireId: needsReviewQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you review privileged access quarterly?"
    });

    await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: cleanQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you enable disk encryption?",
      answerText: "Disk encryption is enabled.",
      chunkText: "All managed devices use full-disk encryption."
    });

    for (const chunkId of [staleSingle.chunkId, staleA.chunkId, staleB.chunkId]) {
      const driftedText = `Drifted questionnaire group evidence ${randomUUID()}`;
      await prisma.documentChunk.update({
        where: {
          id: chunkId
        },
        data: {
          content: driftedText,
          evidenceFingerprint: computeEvidenceFingerprint(driftedText)
        }
      });
    }

    const queue = await listTrustQueueItemsForOrg({ orgId: organization.id });

    expect(queue.questionnaireGroups).toEqual([
      {
        questionnaireId: alsoBlockedQuestionnaire.id,
        questionnaireName: "Vendor Alpha",
        staleCount: 2,
        needsReviewCount: 0,
        blocked: true
      },
      {
        questionnaireId: blockedQuestionnaire.id,
        questionnaireName: "Vendor Zeta",
        staleCount: 1,
        needsReviewCount: 0,
        blocked: true
      },
      {
        questionnaireId: needsReviewQuestionnaire.id,
        questionnaireName: "Vendor Gamma",
        staleCount: 0,
        needsReviewCount: 1,
        blocked: false
      }
    ]);
  });

  it("classifies item priorities and keeps stable fallback ordering within the same bucket", async () => {
    const organization = await createOrganization("priority-ordering");
    const blockedQuestionnaire = await createQuestionnaire(organization.id, "Vendor Delta");
    const p3QuestionnaireA = await createQuestionnaire(organization.id, "Vendor Alpha");
    const p3QuestionnaireB = await createQuestionnaire(organization.id, "Vendor Beta");

    const stale = await seedApprovedQuestion({
      organizationId: organization.id,
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 0,
      questionText: "Do you archive audit logs?",
      answerText: "Audit logs are archived.",
      chunkText: "Audit logs are archived for at least one year."
    });

    const blockedNeedsReview = await createNeedsReviewQuestion({
      questionnaireId: blockedQuestionnaire.id,
      rowIndex: 1,
      questionText: "Do you review termination checklists?"
    });

    const p3Alpha = await createNeedsReviewQuestion({
      questionnaireId: p3QuestionnaireA.id,
      rowIndex: 0,
      questionText: "Do you review firewall changes?"
    });

    const p3Beta = await createNeedsReviewQuestion({
      questionnaireId: p3QuestionnaireB.id,
      rowIndex: 0,
      questionText: "Do you review router changes?"
    });

    const driftedText = `Priority drift ${randomUUID()}`;
    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: driftedText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedText)
      }
    });

    const sharedTimestamp = new Date("2026-03-12T12:00:00.000Z");
    await setQuestionUpdatedAt(blockedNeedsReview.id, sharedTimestamp);
    await setQuestionUpdatedAt(p3Alpha.id, sharedTimestamp);
    await setQuestionUpdatedAt(p3Beta.id, sharedTimestamp);

    const queue = await listTrustQueueItemsForOrg({ orgId: organization.id });

    expect(queue.rows.map((row) => ({
      itemId: row.itemId,
      questionnaireName: row.questionnaireName,
      priority: row.priority,
      blocked: row.isBlockedForApprovedOnlyExport
    }))).toEqual([
      {
        itemId: stale.questionId,
        questionnaireName: "Vendor Delta",
        priority: "P1",
        blocked: true
      },
      {
        itemId: blockedNeedsReview.id,
        questionnaireName: "Vendor Delta",
        priority: "P2",
        blocked: true
      },
      {
        itemId: p3Alpha.id,
        questionnaireName: "Vendor Alpha",
        priority: "P3",
        blocked: false
      },
      {
        itemId: p3Beta.id,
        questionnaireName: "Vendor Beta",
        priority: "P3",
        blocked: false
      }
    ]);

    expect(queue.summary).toEqual({
      staleApprovalsCount: 1,
      needsReviewCount: 3,
      blockedQuestionnairesCount: 1
    });
  });
});
