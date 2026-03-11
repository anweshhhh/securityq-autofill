import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { getApprovedAnswerLibraryDetail } from "@/server/approvedAnswers/getApprovedAnswerLibraryDetail";

const TEST_ORG_PREFIX = "vitest-approved-answer-library-detail-";

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
      name: `approved-answer-library-detail-doc-${suffix}`,
      originalName: `approved-answer-library-detail-doc-${suffix}.txt`,
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

describe.sequential("getApprovedAnswerLibraryDetail", () => {
  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns fresh approval details with provenance metadata", async () => {
    const organization = await createOrganization("fresh");
    const questionnaire = await createQuestionnaire(organization.id, "Library detail questionnaire");
    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How is audit evidence retained?",
      answerText: "Audit evidence is retained for one year.",
      chunkText: "Audit evidence is retained for one year.",
      draftSuggestionApplied: true,
      reusedFromApprovedAnswerId: `reused-${randomUUID()}`
    });

    const detail = await getApprovedAnswerLibraryDetail(
      {
        orgId: organization.id
      },
      seeded.approvedAnswerId
    );

    expect(detail).toMatchObject({
      approvedAnswerId: seeded.approvedAnswerId,
      answerText: "Audit evidence is retained for one year.",
      freshness: "FRESH",
      snapshottedCitationsCount: 1,
      reused: true,
      suggestionAssisted: true,
      staleReasonSummary: null,
      sourceQuestionnaireId: questionnaire.id,
      sourceItemId: seeded.questionId
    });
    expect(detail?.approvedAt).toEqual(expect.any(String));
  });

  it("returns stale reason summary when evidence fingerprints drift", async () => {
    const organization = await createOrganization("stale");
    const questionnaire = await createQuestionnaire(organization.id, "Stale detail questionnaire");
    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How are backups encrypted?",
      answerText: "Backups are encrypted with AES-256.",
      chunkText: "Backups are encrypted with AES-256."
    });

    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: "Backups are encrypted with AES-256-GCM.",
        evidenceFingerprint: computeEvidenceFingerprint("Backups are encrypted with AES-256-GCM.")
      }
    });

    const detail = await getApprovedAnswerLibraryDetail(
      {
        orgId: organization.id
      },
      seeded.approvedAnswerId
    );

    expect(detail).toMatchObject({
      approvedAnswerId: seeded.approvedAnswerId,
      freshness: "STALE",
      staleReasonSummary: {
        affectedCitationsCount: 1,
        changedCount: 1,
        missingCount: 0
      }
    });
  });

  it("returns null for approved answers outside the active organization", async () => {
    const orgA = await createOrganization("org-a");
    const orgB = await createOrganization("org-b");
    const questionnaireB = await createQuestionnaire(orgB.id, "Foreign questionnaire");
    const seeded = await seedApprovedAnswer({
      organizationId: orgB.id,
      questionnaireId: questionnaireB.id,
      rowIndex: 0,
      questionText: "How is data segmented?",
      answerText: "Tenant data is segmented logically.",
      chunkText: "Tenant data is segmented logically."
    });

    const detail = await getApprovedAnswerLibraryDetail(
      {
        orgId: orgA.id
      },
      seeded.approvedAnswerId
    );

    expect(detail).toBeNull();
  });
});
