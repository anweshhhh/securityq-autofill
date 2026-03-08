import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openai", () => ({
  createEmbedding: vi.fn()
}));

import { prisma } from "@/lib/prisma";
import { createEmbedding } from "@/lib/openai";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { embeddingToVectorLiteral } from "@/lib/retrieval";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { getReuseSuggestionsForQuestion } from "@/server/approvedAnswers/getReuseSuggestions";
import { NOT_FOUND_TEXT } from "@/shared/answerTemplates";

const TEST_ORG_PREFIX = "vitest-reuse-suggestions-server-";
const createEmbeddingMock = vi.mocked(createEmbedding);

function sparseEmbedding(primaryIndex: number, secondaryIndex?: number, secondaryWeight = 0.25): number[] {
  const vector = new Array(1536).fill(0);
  vector[primaryIndex] = 1;
  if (secondaryIndex !== undefined) {
    vector[secondaryIndex] = secondaryWeight;
  }
  return vector;
}

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

async function attachQuestionEmbedding(approvedAnswerId: string, embedding: number[]) {
  await prisma.$executeRawUnsafe(
    `
      UPDATE "ApprovedAnswer"
      SET "questionEmbedding" = $1::vector(1536)
      WHERE "id" = $2
    `,
    embeddingToVectorLiteral(embedding),
    approvedAnswerId
  );
}

async function seedApprovedAnswer(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
  answerText: string;
  embedding: number[];
  chunkText?: string;
}) {
  const metadata = buildQuestionTextMetadata(params.questionText);
  const suffix = randomUUID();

  let citationChunkIds: string[] = [];
  let chunkId: string | null = null;
  let docName = `reuse-suggestion-doc-${suffix}`;

  if (params.chunkText) {
    const document = await prisma.document.create({
      data: {
        organizationId: params.organizationId,
        name: docName,
        originalName: `${docName}.txt`,
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

    citationChunkIds = [chunk.id];
    chunkId = chunk.id;
    docName = document.name;
  }

  const question = await prisma.question.create({
    data: {
      questionnaireId: params.questionnaireId,
      rowIndex: params.rowIndex,
      sourceRow: {
        Question: params.questionText
      },
      text: params.questionText,
      answer: params.answerText,
      citations:
        params.chunkText && chunkId
          ? [
              {
                chunkId,
                docName,
                quotedSnippet: params.chunkText
              }
            ]
          : []
    }
  });

  const approvedAnswer = await prisma.approvedAnswer.create({
    data: {
      organizationId: params.organizationId,
      questionId: question.id,
      normalizedQuestionText: metadata.normalizedQuestionText,
      questionTextHash: metadata.questionTextHash,
      answerText: params.answerText,
      citationChunkIds,
      source: "GENERATED"
    }
  });

  await attachQuestionEmbedding(approvedAnswer.id, params.embedding);

  if (citationChunkIds.length > 0) {
    await syncApprovedAnswerEvidenceSnapshots({
      db: prisma,
      organizationId: params.organizationId,
      approvedAnswerId: approvedAnswer.id,
      citationChunkIds
    });
  }

  return {
    approvedAnswerId: approvedAnswer.id,
    questionId: question.id,
    chunkId
  };
}

describe.sequential("getReuseSuggestionsForQuestion", () => {
  beforeEach(() => {
    createEmbeddingMock.mockReset();
  });

  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("excludes stale approvals and returns only fresh candidates", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `reuse-q-${randomUUID()}`,
        totalCount: 2
      }
    });

    const fresh = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do administrators use MFA?",
      answerText: "Administrators are required to use MFA.",
      embedding: sparseEmbedding(4),
      chunkText: "Administrative accounts require multi-factor authentication."
    });

    const stale = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Is MFA enforced for privileged accounts?",
      answerText: "Privileged accounts authenticate with MFA.",
      embedding: sparseEmbedding(4, 5, 0.2),
      chunkText: "Privileged accounts must complete multi-factor authentication."
    });

    const driftedChunkText = "Privileged accounts now authenticate with password-only access.";
    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId as string
      },
      data: {
        content: driftedChunkText,
        evidenceFingerprint: computeEvidenceFingerprint(driftedChunkText)
      }
    });

    createEmbeddingMock.mockResolvedValue(sparseEmbedding(4));

    const suggestions = await getReuseSuggestionsForQuestion({
      orgId: organization.id,
      questionText: "Is MFA required for administrative access?",
      limit: 3
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.approvedAnswerId).toBe(fresh.approvedAnswerId);
  });

  it("excludes NOT_FOUND approved answers from suggestions", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${randomUUID()}`
      }
    });

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `reuse-q-${randomUUID()}`,
        totalCount: 2
      }
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you maintain a FedRAMP authorization?",
      answerText: NOT_FOUND_TEXT,
      embedding: sparseEmbedding(9)
    });

    const found = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "What minimum TLS version is required?",
      answerText: "TLS 1.2 or higher is required for external traffic.",
      embedding: sparseEmbedding(9, 10, 0.15),
      chunkText: "TLS 1.2 or higher is required for all external network traffic."
    });

    createEmbeddingMock.mockResolvedValue(sparseEmbedding(9));

    const suggestions = await getReuseSuggestionsForQuestion({
      orgId: organization.id,
      questionText: "What TLS requirement applies to inbound traffic?",
      limit: 3
    });

    expect(suggestions.map((suggestion) => suggestion.approvedAnswerId)).toEqual([found.approvedAnswerId]);
  });
});
