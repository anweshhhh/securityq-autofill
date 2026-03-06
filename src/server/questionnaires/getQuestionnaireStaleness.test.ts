import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { getQuestionnaireStaleness } from "@/server/questionnaires/getQuestionnaireStaleness";

const TEST_ORG_PREFIX = "vitest-questionnaire-staleness-summary-";

async function cleanupQuestionnaireStalenessData() {
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
      name: `staleness-summary-${randomUUID()}`,
      originalName: `staleness-summary-${randomUUID()}.txt`,
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
    chunkId: chunk.id,
    approvedAnswerId: approvedAnswer.id
  };
}

describe.sequential("questionnaire staleness summary helper", () => {
  afterEach(async () => {
    await cleanupQuestionnaireStalenessData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns no stale items when approvals are fresh", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}fresh-${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: "Fresh approvals questionnaire"
      }
    });

    const seed = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you use MFA for admin access?",
      answerText: "MFA is required.",
      chunkText: "All administrative access requires MFA."
    });

    const staleness = await getQuestionnaireStaleness({ orgId: organization.id }, questionnaire.id);

    expect(staleness.staleCount).toBe(0);
    expect(staleness.staleItems).toEqual([]);
    expect(seed.approvedAnswerId.length).toBeGreaterThan(0);
  });

  it("returns stale items when approval evidence drifts", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}stale-${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: "Stale approvals questionnaire"
      }
    });

    const staleQuestion = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Is TLS 1.2 required?",
      answerText: "TLS 1.2 is required.",
      chunkText: "TLS 1.2+ is required for all external traffic."
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Do you encrypt data in transit?",
      answerText: "Data is encrypted in transit.",
      chunkText: "All network traffic is encrypted in transit."
    });

    const staleChunkText = "Encryption policy changed to no longer mention TLS 1.2.";
    await prisma.documentChunk.update({
      where: {
        id: staleQuestion.chunkId
      },
      data: {
        content: staleChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(staleChunkText)
      }
    });

    const staleness = await getQuestionnaireStaleness({ orgId: organization.id }, questionnaire.id);

    expect(staleness.staleCount).toBe(1);
    expect(staleness.staleItems).toEqual([{ questionnaireItemId: staleQuestion.questionId, rowIndex: 0 }]);
  });
});

