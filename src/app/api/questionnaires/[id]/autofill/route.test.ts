import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_FOUND_RESPONSE } from "@/lib/answering";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

const { answerQuestionWithEvidenceMock } = vi.hoisted(() => ({
  answerQuestionWithEvidenceMock: vi.fn()
}));

vi.mock("@/lib/answering", async () => {
  const actual = await vi.importActual<typeof import("@/lib/answering")>("@/lib/answering");
  return {
    ...actual,
    answerQuestionWithEvidence: answerQuestionWithEvidenceMock
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
  });

  afterEach(async () => {
    await cleanupQuestionnaires();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("autofills in row order and exports CSV with answer columns", async () => {
    const organization = await getOrCreateDefaultOrganization();

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `${TEST_QUESTIONNAIRE_NAME_PREFIX}${Date.now()}`,
        questionColumn: "Question",
        sourceHeaders: ["Question", "Control ID"],
        sourceFileName: "test.csv"
      }
    });

    await prisma.question.createMany({
      data: [
        {
          questionnaireId: questionnaire.id,
          rowIndex: 0,
          text: "Do you enforce TLS 1.2+?",
          sourceRow: {
            Question: "Do you enforce TLS 1.2+?",
            "Control ID": "ENC-1"
          },
          citations: []
        },
        {
          questionnaireId: questionnaire.id,
          rowIndex: 1,
          text: "Are backups encrypted?",
          sourceRow: {
            Question: "Are backups encrypted?",
            "Control ID": "ENC-2"
          },
          citations: []
        }
      ]
    });

    answerQuestionWithEvidenceMock
      .mockResolvedValueOnce({
        answer: "Yes, TLS 1.2+ is enforced.",
        citations: [
          {
            docName: "Security Doc",
            chunkId: "chunk-1",
            quotedSnippet: "TLS 1.2 or higher is required"
          }
        ],
        confidence: "high",
        needsReview: false
      })
      .mockResolvedValueOnce(NOT_FOUND_RESPONSE);

    const autofillResponse = await runAutofill(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });

    expect(autofillResponse.status).toBe(200);

    const updatedQuestions = await prisma.question.findMany({
      where: { questionnaireId: questionnaire.id },
      orderBy: { rowIndex: "asc" }
    });

    expect(updatedQuestions[0].answer).toBe("Yes, TLS 1.2+ is enforced.");
    expect(updatedQuestions[0].confidence).toBe("high");
    expect(updatedQuestions[0].needsReview).toBe(false);

    expect(updatedQuestions[1].answer).toBe("Not found in provided documents.");
    expect(updatedQuestions[1].confidence).toBe("low");
    expect(updatedQuestions[1].needsReview).toBe(true);

    const exportResponse = await exportCsv(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");

    const exportCsvText = await exportResponse.text();
    expect(exportCsvText).toContain('"Answer","Citations","Confidence","Needs Review"');
    expect(exportCsvText).toContain("Yes, TLS 1.2+ is enforced.");
    expect(exportCsvText).toContain("Not found in provided documents.");
    expect(exportCsvText).toContain("Security Doc#chunk-1");
  });
});
