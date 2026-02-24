import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const {
  answerQuestionMock,
  getEmbeddingAvailabilityMock
} = vi.hoisted(() => ({
  answerQuestionMock: vi.fn(),
  getEmbeddingAvailabilityMock: vi.fn()
}));

vi.mock("@/server/answerEngine", async () => {
  const actual = await vi.importActual<typeof import("@/server/answerEngine")>(
    "@/server/answerEngine"
  );
  return {
    ...actual,
    answerQuestion: answerQuestionMock
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

import { POST as importRoute } from "./import/route";
import { POST as autofillRoute } from "./[id]/autofill/route";
import { GET as exportRoute } from "./[id]/export/route";
import { DELETE as deleteRoute } from "./[id]/route";

const TEST_QUESTIONNAIRE_NAME_PREFIX = "vitest-workflow-";

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

describe.sequential("questionnaire workflow integration", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    await cleanupQuestionnaires();
    answerQuestionMock.mockReset();
    getEmbeddingAvailabilityMock.mockReset();
    getEmbeddingAvailabilityMock.mockResolvedValue({ total: 1, embedded: 1, missing: 0 });
  });

  afterEach(async () => {
    await cleanupQuestionnaires();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("imports csv, runs autofill, exports answers/citations, and deletes questionnaire", async () => {
    const csvContent =
      "Control ID,Question\n" +
      "ENC-1,Is TLS enabled?\n" +
      "ENC-2,Do you support SSO?\n";

    const formData = new FormData();
    formData.append("file", new File([csvContent], "workflow.csv", { type: "text/csv" }));
    formData.append("questionColumn", "Question");
    formData.append("name", `${TEST_QUESTIONNAIRE_NAME_PREFIX}${Date.now()}`);

    const importResponse = await importRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: formData
      })
    );
    const importPayload = (await importResponse.json()) as {
      questionnaire?: { id: string };
      error?: string;
    };

    expect(importResponse.status).toBe(201);
    const questionnaireId = importPayload.questionnaire?.id;
    expect(questionnaireId).toBeTruthy();

    answerQuestionMock
      .mockResolvedValueOnce({
        answer: "TLS 1.2+ is enabled for external traffic.",
        citations: [{ docName: "Security Doc", chunkId: "chunk-1", quotedSnippet: "TLS 1.2+ is enabled." }]
      })
      .mockResolvedValueOnce({
        answer: "Not found in provided documents.",
        citations: []
      });

    const autofillResponse = await autofillRoute(new Request("http://localhost"), {
      params: { id: questionnaireId as string }
    });
    const autofillPayload = await autofillResponse.json();

    expect(autofillResponse.status).toBe(200);
    expect(autofillPayload.totalCount).toBe(2);
    expect(autofillPayload.answeredCount).toBe(2);
    expect(autofillPayload.notFoundCount).toBe(1);
    expect(answerQuestionMock).toHaveBeenCalledTimes(2);

    const exportResponse = await exportRoute(new Request("http://localhost"), {
      params: { id: questionnaireId as string }
    });

    expect(exportResponse.status).toBe(200);
    const exportCsv = await exportResponse.text();
    expect(exportCsv).toContain('"Answer","Citations"');
    expect(exportCsv).toContain("TLS 1.2+ is enabled");
    expect(exportCsv).toContain("Security Doc#chunk-1");

    const deleteResponse = await deleteRoute(new Request("http://localhost", { method: "DELETE" }), {
      params: { id: questionnaireId as string }
    });
    const deletePayload = (await deleteResponse.json()) as { ok?: boolean };

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.ok).toBe(true);

    const questionnaire = await prisma.questionnaire.findUnique({
      where: { id: questionnaireId as string }
    });
    expect(questionnaire).toBeNull();
  });
});
