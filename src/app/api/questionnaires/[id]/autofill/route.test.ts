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

import { POST as runAutofill } from "./route";
import { GET as exportCsv } from "../export/route";

const TEST_QUESTIONNAIRE_NAME_PREFIX = "vitest-questionnaire-";

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

describe.sequential("questionnaire autofill + export", () => {
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

  it("autofills in resumable batches and exports csv columns", async () => {
    const notFoundNoRelevant = { ...NOT_FOUND_RESPONSE, notFoundReason: "NO_RELEVANT_EVIDENCE" as const };
    const notFoundBelowThreshold = {
      ...NOT_FOUND_RESPONSE,
      notFoundReason: "RETRIEVAL_BELOW_THRESHOLD" as const
    };

    const organization = await getOrCreateDefaultOrganization();

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `${TEST_QUESTIONNAIRE_NAME_PREFIX}${Date.now()}`,
        questionColumn: "Question",
        sourceHeaders: ["Question", "Control ID"],
        sourceFileName: "test.csv",
        totalCount: 7
      }
    });

    await prisma.question.createMany({
      data: Array.from({ length: 7 }).map((_, index) => ({
        questionnaireId: questionnaire.id,
        rowIndex: index,
        text: `Question ${index + 1}`,
        sourceRow: {
          Question: `Question ${index + 1}`,
          "Control ID": `CTRL-${index + 1}`
        },
        citations: []
      }))
    });

    answerQuestionWithEvidenceMock
      .mockResolvedValueOnce({
        answer: "Found A1",
        citations: [
          {
            docName: "Security Doc",
            chunkId: "chunk-1",
            quotedSnippet: "Snippet 1"
          }
        ],
        confidence: "high",
        needsReview: false
      })
      .mockResolvedValueOnce(notFoundNoRelevant)
      .mockResolvedValueOnce({
        answer: "Found A3",
        citations: [
          {
            docName: "Security Doc",
            chunkId: "chunk-3",
            quotedSnippet: "Snippet 3"
          }
        ],
        confidence: "med",
        needsReview: false
      })
      .mockResolvedValueOnce(notFoundNoRelevant)
      .mockResolvedValueOnce(notFoundBelowThreshold)
      .mockResolvedValueOnce({
        answer: "Found A6",
        citations: [
          {
            docName: "Security Doc",
            chunkId: "chunk-6",
            quotedSnippet: "Snippet 6"
          }
        ],
        confidence: "high",
        needsReview: false
      })
      .mockResolvedValueOnce(notFoundNoRelevant);

    const firstResponse = await runAutofill(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });
    const firstPayload = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstPayload.status).toBe("RUNNING");
    expect(firstPayload.processedCount).toBe(5);
    expect(firstPayload.totalCount).toBe(7);

    const secondResponse = await runAutofill(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });
    const secondPayload = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondPayload.status).toBe("COMPLETED");
    expect(secondPayload.processedCount).toBe(7);
    expect(secondPayload.foundCount).toBe(3);
    expect(secondPayload.notFoundCount).toBe(4);

    const updatedQuestions = await prisma.question.findMany({
      where: { questionnaireId: questionnaire.id },
      orderBy: { rowIndex: "asc" }
    });

    expect(updatedQuestions).toHaveLength(7);
    expect(updatedQuestions[0].answer).toBe("Found A1");
    expect(updatedQuestions[1].answer).toBe("Not found in provided documents.");
    expect(updatedQuestions[1].notFoundReason).toBe("NO_RELEVANT_EVIDENCE");
    expect(updatedQuestions[4].notFoundReason).toBe("RETRIEVAL_BELOW_THRESHOLD");
    expect(updatedQuestions[6].answer).toBe("Not found in provided documents.");

    const exportResponse = await exportCsv(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });

    expect(exportResponse.status).toBe(200);

    const exportCsvText = await exportResponse.text();
    expect(exportCsvText).toContain('"Answer","Citations","Confidence","Needs Review","NotFoundReason"');
    expect(exportCsvText).toContain("Found A1");
    expect(exportCsvText).toContain("Not found in provided documents.");
    expect(exportCsvText).toContain("Security Doc#chunk-1");
    expect(exportCsvText).toContain("NO_RELEVANT_EVIDENCE");
    expect(exportCsvText).toContain("RETRIEVAL_BELOW_THRESHOLD");
  });
});
