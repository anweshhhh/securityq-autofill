import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const {
  answerQuestionMock,
  getEmbeddingAvailabilityMock,
  createEmbeddingMock,
  generateGroundedAnswerMock,
  generateEvidenceSufficiencyMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  answerQuestionMock: vi.fn(),
  getEmbeddingAvailabilityMock: vi.fn(),
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock
}));

vi.mock("@/lib/retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
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

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), `test/fixtures/${name}`), "utf8");
}

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
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();
    getEmbeddingAvailabilityMock.mockResolvedValue({ total: 1, embedded: 1, missing: 0 });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.02));
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

  it("autofill keeps sufficient cited TLS-version answers as FOUND and does not clobber to PARTIAL", async () => {
    const evidenceA = fixture("evidence-a.txt");
    const evidenceB = fixture("evidence-b.txt");
    const notFoundText = "Not found in provided documents.";
    const notSpecifiedText = "Not specified in provided documents.";

    const csvContent =
      "Control ID,Question\n" +
      "ENC-1,What minimum TLS version is required for external traffic?\n" +
      "AUD-1,What SOC report period is documented?\n" +
      "ENC-2,Are key rotation intervals specified for encryption at rest?\n";

    const formData = new FormData();
    formData.append("file", new File([csvContent], "workflow-regression.csv", { type: "text/csv" }));
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
    };

    expect(importResponse.status).toBe(201);
    const questionnaireId = importPayload.questionnaire?.id;
    expect(questionnaireId).toBeTruthy();

    const actualAnswerEngine = await vi.importActual<typeof import("@/server/answerEngine")>(
      "@/server/answerEngine"
    );
    answerQuestionMock.mockImplementation((params) => actualAnswerEngine.answerQuestion(params));

    retrieveTopChunksMock.mockImplementation(async (params: { questionText: string }) => {
      const question = params.questionText.toLowerCase();
      if (question.includes("minimum tls version")) {
        return [
          {
            chunkId: "chunk-tls-1",
            docName: "Evidence A",
            quotedSnippet: evidenceA,
            fullContent: evidenceA,
            similarity: 0.92
          },
          {
            chunkId: "chunk-tls-2",
            docName: "Evidence B",
            quotedSnippet: evidenceB,
            fullContent: evidenceB,
            similarity: 0.82
          }
        ];
      }

      if (question.includes("soc report period")) {
        return [
          {
            chunkId: "chunk-soc-1",
            docName: "Evidence B",
            quotedSnippet: evidenceB,
            fullContent: evidenceB,
            similarity: 0.51
          }
        ];
      }

      return [
        {
          chunkId: "chunk-rest-1",
          docName: "Evidence A",
          quotedSnippet: evidenceA,
          fullContent: evidenceA,
          similarity: 0.88
        }
      ];
    });

    generateEvidenceSufficiencyMock.mockImplementation(async (params: { question: string; snippets: Array<{ chunkId: string }> }) => {
      const question = params.question.toLowerCase();
      if (question.includes("minimum tls version")) {
        return {
          sufficient: true,
          bestChunkIds: params.snippets.map((snippet) => snippet.chunkId),
          missingPoints: []
        };
      }

      if (question.includes("soc report period")) {
        return {
          sufficient: false,
          bestChunkIds: [],
          missingPoints: ["Report period not provided"]
        };
      }

      return {
        sufficient: true,
        bestChunkIds: [params.snippets[0]?.chunkId].filter(Boolean),
        missingPoints: []
      };
    });

    generateGroundedAnswerMock.mockImplementation(
      async (params: { question: string; snippets: Array<{ chunkId: string; quotedSnippet: string }> }) => {
        const question = params.question.toLowerCase();
        if (question.includes("minimum tls version")) {
          return {
            answer: "Yes, data is encrypted in transit. The minimum TLS version enforced is TLS 1.2.",
            citations: params.snippets.slice(0, 2).map((snippet) => ({
              chunkId: snippet.chunkId,
              quotedSnippet: snippet.quotedSnippet
            })),
            confidence: "high" as const,
            needsReview: false
          };
        }

        if (question.includes("soc report period")) {
          return {
            answer: notFoundText,
            citations: [],
            confidence: "low" as const,
            needsReview: true
          };
        }

        return {
          answer: notSpecifiedText,
          citations: params.snippets.slice(0, 1).map((snippet) => ({
            chunkId: snippet.chunkId,
            quotedSnippet: snippet.quotedSnippet
          })),
          confidence: "med" as const,
          needsReview: true
        };
      }
    );

    const autofillResponse = await autofillRoute(new Request("http://localhost"), {
      params: { id: questionnaireId as string }
    });
    const autofillPayload = (await autofillResponse.json()) as {
      totalCount: number;
      answeredCount: number;
      foundCount: number;
      notFoundCount: number;
    };

    expect(autofillResponse.status).toBe(200);
    expect(autofillPayload.totalCount).toBe(3);
    expect(autofillPayload.answeredCount).toBe(3);
    expect(autofillPayload.foundCount).toBe(2);
    expect(autofillPayload.notFoundCount).toBe(1);
    expect(answerQuestionMock).toHaveBeenCalledTimes(3);

    const storedQuestions = await prisma.question.findMany({
      where: { questionnaireId: questionnaireId as string },
      orderBy: { rowIndex: "asc" },
      select: {
        text: true,
        answer: true,
        citations: true
      }
    });

    const tlsQuestion = storedQuestions.find((question) =>
      question.text.toLowerCase().includes("minimum tls version")
    );
    expect(tlsQuestion?.answer).toContain("TLS 1.2");
    expect(tlsQuestion?.answer).not.toBe(notSpecifiedText);
    expect(Array.isArray(tlsQuestion?.citations)).toBe(true);
    expect((tlsQuestion?.citations as Array<unknown>).length).toBeGreaterThan(0);

    const notFoundQuestion = storedQuestions.find((question) =>
      question.text.toLowerCase().includes("soc report period")
    );
    expect(notFoundQuestion?.answer).toBe(notFoundText);
    expect(notFoundQuestion?.citations).toEqual([]);

    const partialQuestion = storedQuestions.find((question) =>
      question.text.toLowerCase().includes("key rotation intervals")
    );
    expect(partialQuestion?.answer).toBe(notSpecifiedText);
    expect(Array.isArray(partialQuestion?.citations)).toBe(true);
    expect((partialQuestion?.citations as Array<unknown>).length).toBeGreaterThan(0);
  });
});
