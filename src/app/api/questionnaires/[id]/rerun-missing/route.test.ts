import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_FOUND_RESPONSE } from "@/lib/answering";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

const {
  answerQuestionWithEvidenceMock,
  getEmbeddingAvailabilityMock
} = vi.hoisted(() => ({
  answerQuestionWithEvidenceMock: vi.fn(),
  getEmbeddingAvailabilityMock: vi.fn()
}));

vi.mock("@/lib/answering", async () => {
  const actual = await vi.importActual<typeof import("@/lib/answering")>("@/lib/answering");
  return {
    ...actual,
    answerQuestionWithEvidence: answerQuestionWithEvidenceMock
  };
});

vi.mock("@/lib/questionnaireService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/questionnaireService")>(
    "@/lib/questionnaireService"
  );

  return {
    ...actual,
    getEmbeddingAvailability: getEmbeddingAvailabilityMock
  };
});

import { POST as rerunMissing } from "./route";

const TEST_QUESTIONNAIRE_NAME_PREFIX = "vitest-rerun-missing-";

async function cleanupQuestionnaires() {
  const questionnaires = await prisma.questionnaire.findMany({
    where: {
      name: {
        startsWith: TEST_QUESTIONNAIRE_NAME_PREFIX
      }
    },
    select: {
      id: true
    }
  });

  if (questionnaires.length === 0) {
    return;
  }

  const questionnaireIds = questionnaires.map((questionnaire) => questionnaire.id);

  await prisma.approvedAnswer.deleteMany({
    where: {
      question: {
        questionnaireId: {
          in: questionnaireIds
        }
      }
    }
  });

  await prisma.question.deleteMany({
    where: {
      questionnaireId: {
        in: questionnaireIds
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
}

describe.sequential("questionnaire rerun-missing route", () => {
  beforeEach(async () => {
    await cleanupQuestionnaires();
    answerQuestionWithEvidenceMock.mockReset();
    getEmbeddingAvailabilityMock.mockResolvedValue({ total: 1, embedded: 1, missing: 0 });
  });

  afterEach(async () => {
    await cleanupQuestionnaires();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("updates only missing questions and keeps already found answers untouched", async () => {
    const organization = await getOrCreateDefaultOrganization();
    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `${TEST_QUESTIONNAIRE_NAME_PREFIX}${Date.now()}`,
        questionColumn: "Question",
        sourceHeaders: ["Question"],
        totalCount: 3,
        processedCount: 3,
        foundCount: 1,
        notFoundCount: 2,
        runStatus: "COMPLETED"
      }
    });

    await prisma.question.createMany({
      data: [
        {
          questionnaireId: questionnaire.id,
          rowIndex: 0,
          text: "Row 0 question",
          sourceRow: { Question: "Row 0 question" },
          answer: "Already found answer",
          citations: [{ docName: "Doc A", chunkId: "c0", quotedSnippet: "Proof A" }],
          confidence: "high",
          needsReview: false
        },
        {
          questionnaireId: questionnaire.id,
          rowIndex: 1,
          text: "Row 1 question",
          sourceRow: { Question: "Row 1 question" },
          answer: NOT_FOUND_RESPONSE.answer,
          citations: [],
          confidence: "low",
          needsReview: true,
          notFoundReason: "NO_RELEVANT_EVIDENCE"
        },
        {
          questionnaireId: questionnaire.id,
          rowIndex: 2,
          text: "Row 2 question",
          sourceRow: { Question: "Row 2 question" },
          answer: NOT_FOUND_RESPONSE.answer,
          citations: [],
          confidence: "low",
          needsReview: true,
          notFoundReason: "NO_RELEVANT_EVIDENCE"
        }
      ]
    });

    answerQuestionWithEvidenceMock
      .mockResolvedValueOnce({
        answer: "Updated found answer",
        citations: [{ docName: "Doc B", chunkId: "c1", quotedSnippet: "Proof B" }],
        confidence: "med",
        needsReview: false
      })
      .mockResolvedValueOnce({
        ...NOT_FOUND_RESPONSE,
        notFoundReason: "FILTERED_AS_IRRELEVANT"
      });

    const response = await rerunMissing(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("COMPLETED");
    expect(payload.foundCount).toBe(2);
    expect(payload.notFoundCount).toBe(1);
    expect(answerQuestionWithEvidenceMock).toHaveBeenCalledTimes(2);
    expect(answerQuestionWithEvidenceMock).toHaveBeenNthCalledWith(1, {
      organizationId: organization.id,
      question: "Row 1 question"
    });
    expect(answerQuestionWithEvidenceMock).toHaveBeenNthCalledWith(2, {
      organizationId: organization.id,
      question: "Row 2 question"
    });

    const questions = await prisma.question.findMany({
      where: { questionnaireId: questionnaire.id },
      orderBy: { rowIndex: "asc" }
    });

    expect(questions[0].answer).toBe("Already found answer");
    expect(questions[0].citations).toEqual([{ docName: "Doc A", chunkId: "c0", quotedSnippet: "Proof A" }]);
    expect(questions[1].answer).toBe("Updated found answer");
    expect(questions[1].notFoundReason).toBeNull();
    expect(questions[2].answer).toBe(NOT_FOUND_RESPONSE.answer);
    expect(questions[2].notFoundReason).toBe("FILTERED_AS_IRRELEVANT");

    const updatedQuestionnaire = await prisma.questionnaire.findUnique({
      where: { id: questionnaire.id }
    });
    expect(updatedQuestionnaire?.processedCount).toBe(3);
    expect(updatedQuestionnaire?.foundCount).toBe(2);
    expect(updatedQuestionnaire?.notFoundCount).toBe(1);
  });
});
