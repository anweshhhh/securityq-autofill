import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createApprovedAnswerReuseMatcher } from "@/lib/approvedAnswerReuse";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { isApprovedAnswerStale } from "@/server/approvedAnswers/staleness";

const TEST_ORG_PREFIX = "vitest-approved-staleness-";

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

async function seedApprovedAnswer(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
  answerText: string;
  chunkText: string;
}): Promise<{
  approvedAnswerId: string;
  chunkId: string;
}> {
  const suffix = randomUUID();
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `evidence-${suffix}`,
      originalName: `evidence-${suffix}.txt`,
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
    approvedAnswerId: approvedAnswer.id,
    chunkId: chunk.id
  };
}

describe.sequential("approved answer evidence snapshot + staleness", () => {
  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists chunk fingerprint snapshots when an answer is approved", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `q-${randomUUID()}`,
        totalCount: 1
      }
    });

    const chunkText = "Access is limited to authorized personnel and reviewed monthly.";
    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "How do you limit access to customer data?",
      answerText: "Access is limited to authorized personnel.",
      chunkText
    });

    const snapshots = await prisma.approvedAnswerEvidence.findMany({
      where: {
        approvedAnswerId: seeded.approvedAnswerId
      },
      select: {
        chunkId: true,
        fingerprintAtApproval: true
      }
    });

    expect(snapshots).toEqual([
      {
        chunkId: seeded.chunkId,
        fingerprintAtApproval: computeEvidenceFingerprint(chunkText)
      }
    ]);
  });

  it("marks approval stale when cited chunk fingerprint drifts", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `q-${randomUUID()}`,
        totalCount: 1
      }
    });

    const seeded = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "What encryption is used at rest?",
      answerText: "Data is encrypted using AES-256.",
      chunkText: "Data is encrypted using AES-256 with centralized key management."
    });

    await expect(isApprovedAnswerStale(seeded.approvedAnswerId, { orgId: organization.id })).resolves.toBe(false);

    const updatedChunkText = "Data is encrypted at rest, but algorithm details are not specified.";
    await prisma.documentChunk.update({
      where: {
        id: seeded.chunkId
      },
      data: {
        content: updatedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(updatedChunkText)
      }
    });

    await expect(isApprovedAnswerStale(seeded.approvedAnswerId, { orgId: organization.id })).resolves.toBe(true);
  });

  it("excludes stale approvals from exact reuse candidates", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `q-${randomUUID()}`,
        totalCount: 2
      }
    });

    const questionText = "Do you enforce MFA for privileged access?";

    const fresh = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText,
      answerText: "Yes, MFA is required for all privileged access.",
      chunkText: "MFA is mandatory for all privileged access paths."
    });

    const stale = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText,
      answerText: "Yes, MFA is required for privileged access.",
      chunkText: "Privileged access must use MFA."
    });

    const driftedChunkText = "Privileged access policy was changed and MFA scope is pending.";
    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: driftedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedChunkText)
      }
    });

    const matcher = await createApprovedAnswerReuseMatcher({
      organizationId: organization.id
    });

    const reused = await matcher.findForQuestion(questionText);
    expect(reused).not.toBeNull();
    expect(reused?.approvedAnswerId).toBe(fresh.approvedAnswerId);
    expect(reused?.matchType).toBe("exact");
  });
});
