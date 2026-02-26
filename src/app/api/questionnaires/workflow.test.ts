import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvText } from "@/lib/csv";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

const {
  answerQuestionMock,
  getEmbeddingAvailabilityMock,
  createEmbeddingMock,
  generateGroundedAnswerMock,
  generateEvidenceSufficiencyMock,
  generateLegacyEvidenceSufficiencyMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  answerQuestionMock: vi.fn(),
  getEmbeddingAvailabilityMock: vi.fn(),
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock,
  generateLegacyEvidenceSufficiency: generateLegacyEvidenceSufficiencyMock
}));

vi.mock("@/lib/retrieval", async () => {
  const actual = await vi.importActual<typeof import("@/lib/retrieval")>("@/lib/retrieval");
  return {
    ...actual,
    countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
    retrieveTopChunks: retrieveTopChunksMock
  };
});

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
import { DELETE as deleteRoute, GET as questionnaireDetailsRoute } from "./[id]/route";
import { POST as approvedAnswersCreateRoute } from "../approved-answers/route";
import {
  DELETE as approvedAnswersDeleteRoute,
  PATCH as approvedAnswersPatchRoute
} from "../approved-answers/[id]/route";
import { POST as questionReviewRoute } from "../questions/[id]/review/route";

const TEST_QUESTIONNAIRE_NAME_PREFIX = "vitest-workflow-";
const TEST_DOCUMENT_NAME_PREFIX = "vitest-workflow-doc-";
const TEST_ORG_NAME_PREFIX = "vitest-workflow-org-";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), `test/fixtures/${name}`), "utf8");
}

function sparseEmbedding(index: number, secondaryIndex?: number, secondaryWeight = 0.01): number[] {
  const vector = new Array(1536).fill(0);
  vector[index] = 1;
  if (secondaryIndex !== undefined) {
    vector[secondaryIndex] = secondaryWeight;
  }

  return vector;
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

async function cleanupWorkflowDocuments() {
  const documents = await prisma.document.findMany({
    where: {
      name: {
        startsWith: TEST_DOCUMENT_NAME_PREFIX
      }
    },
    select: {
      id: true
    }
  });

  if (documents.length === 0) {
    return;
  }

  const documentIds = documents.map((document) => document.id);
  await prisma.documentChunk.deleteMany({
    where: {
      documentId: {
        in: documentIds
      }
    }
  });

  await prisma.document.deleteMany({
    where: {
      id: {
        in: documentIds
      }
    }
  });
}

async function cleanupWorkflowOrganizations() {
  const organizations = await prisma.organization.findMany({
    where: {
      name: {
        startsWith: TEST_ORG_NAME_PREFIX
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

async function cleanupWorkflowData() {
  await cleanupQuestionnaires();
  await cleanupWorkflowDocuments();
  await cleanupWorkflowOrganizations();
}

async function seedEvidenceChunksForOrganization(organizationId: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const documentA = await prisma.document.create({
    data: {
      organizationId,
      name: `${TEST_DOCUMENT_NAME_PREFIX}${suffix}-a`,
      originalName: "workflow-a.txt",
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const documentB = await prisma.document.create({
    data: {
      organizationId,
      name: `${TEST_DOCUMENT_NAME_PREFIX}${suffix}-b`,
      originalName: "workflow-b.txt",
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const tlsChunk = await prisma.documentChunk.create({
    data: {
      documentId: documentA.id,
      chunkIndex: 0,
      content: "External traffic requires TLS 1.2 or higher."
    }
  });

  const ssoChunk = await prisma.documentChunk.create({
    data: {
      documentId: documentA.id,
      chunkIndex: 1,
      content: "Single sign-on is supported for workforce identity providers."
    }
  });

  const partialChunk = await prisma.documentChunk.create({
    data: {
      documentId: documentB.id,
      chunkIndex: 0,
      content: "Encryption at rest is enabled."
    }
  });

  return {
    tlsChunkId: tlsChunk.id,
    ssoChunkId: ssoChunk.id,
    partialChunkId: partialChunk.id
  };
}

describe.sequential("questionnaire workflow integration", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";
    await cleanupWorkflowData();
    answerQuestionMock.mockReset();
    getEmbeddingAvailabilityMock.mockReset();
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();
    getEmbeddingAvailabilityMock.mockResolvedValue({ total: 1, embedded: 1, missing: 0 });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.02));
  });

  afterEach(async () => {
    await cleanupWorkflowData();
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
          requirements: ["Minimum TLS version", "Transit encryption"],
          extracted: [
            {
              requirement: "Minimum TLS version",
              value: "Minimum TLS version enforced is TLS 1.2.",
              supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 2)
            },
            {
              requirement: "Transit encryption",
              value: "Data is encrypted in transit.",
              supportingChunkIds: params.snippets.map((snippet) => snippet.chunkId).slice(0, 1)
            }
          ],
          overall: "FOUND"
        };
      }

      if (question.includes("soc report period")) {
        return {
          requirements: ["SOC report period"],
          extracted: [
            {
              requirement: "SOC report period",
              value: null,
              supportingChunkIds: []
            }
          ],
          overall: "NOT_FOUND"
        };
      }

      return {
        requirements: ["Key rotation interval", "Encryption at rest"],
        extracted: [
          {
            requirement: "Encryption at rest",
            value: "Encryption at rest is enabled.",
            supportingChunkIds: [params.snippets[0]?.chunkId].filter(Boolean)
          },
          {
            requirement: "Key rotation interval",
            value: null,
            supportingChunkIds: []
          }
        ],
        overall: "PARTIAL"
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

  it("approval API flow supports approve/edit/review/unapprove with org-scoped citation validation", async () => {
    const organization = await getOrCreateDefaultOrganization();
    const chunkIds = await seedEvidenceChunksForOrganization(organization.id);

    const csvContent =
      "Control ID,Question\n" +
      "Q-1,What minimum TLS version is required?\n" +
      "Q-2,Do you support SSO?\n" +
      "Q-3,What is the encryption key rotation interval?\n";

    const formData = new FormData();
    formData.append("file", new File([csvContent], "approval-flow.csv", { type: "text/csv" }));
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

    answerQuestionMock
      .mockResolvedValueOnce({
        answer: "External traffic requires TLS 1.2.",
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.tlsChunkId,
            quotedSnippet: "External traffic requires TLS 1.2 or higher."
          }
        ]
      })
      .mockResolvedValueOnce({
        answer: "Single sign-on is supported.",
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.ssoChunkId,
            quotedSnippet: "Single sign-on is supported for workforce identity providers."
          }
        ]
      })
      .mockResolvedValueOnce({
        answer: "Not specified in provided documents.",
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.partialChunkId,
            quotedSnippet: "Encryption at rest is enabled."
          }
        ]
      });

    const autofillResponse = await autofillRoute(new Request("http://localhost"), {
      params: { id: questionnaireId as string }
    });
    expect(autofillResponse.status).toBe(200);

    const questions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireId as string
      },
      orderBy: {
        rowIndex: "asc"
      },
      select: {
        id: true,
        reviewStatus: true
      }
    });
    expect(questions).toHaveLength(3);
    expect(questions.map((question) => question.reviewStatus)).toEqual(["DRAFT", "DRAFT", "DRAFT"]);

    const firstApprovalResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: questions[0].id
        })
      })
    );
    const firstApprovalPayload = (await firstApprovalResponse.json()) as {
      approvedAnswer?: { id: string };
    };
    expect(firstApprovalResponse.status).toBe(200);
    expect(firstApprovalPayload.approvedAnswer?.id).toBeTruthy();

    const secondApprovalResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: questions[1].id
        })
      })
    );
    const secondApprovalPayload = (await secondApprovalResponse.json()) as {
      approvedAnswer?: { id: string };
    };
    expect(secondApprovalResponse.status).toBe(200);
    expect(secondApprovalPayload.approvedAnswer?.id).toBeTruthy();

    const editedApprovedAnswerText = "SSO is enabled and can be integrated through supported identity providers.";
    const patchResponse = await approvedAnswersPatchRoute(
      new Request(`http://localhost/api/approved-answers/${secondApprovalPayload.approvedAnswer?.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: editedApprovedAnswerText,
          citationChunkIds: [chunkIds.ssoChunkId]
        })
      }),
      {
        params: {
          id: secondApprovalPayload.approvedAnswer?.id as string
        }
      }
    );
    expect(patchResponse.status).toBe(200);

    const needsReviewResponse = await questionReviewRoute(
      new Request(`http://localhost/api/questions/${questions[2].id}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reviewStatus: "NEEDS_REVIEW"
        })
      }),
      {
        params: {
          id: questions[2].id
        }
      }
    );
    expect(needsReviewResponse.status).toBe(200);

    const unapproveResponse = await approvedAnswersDeleteRoute(
      new Request(`http://localhost/api/approved-answers/${firstApprovalPayload.approvedAnswer?.id}`, {
        method: "DELETE"
      }),
      {
        params: {
          id: firstApprovalPayload.approvedAnswer?.id as string
        }
      }
    );
    expect(unapproveResponse.status).toBe(200);

    const refreshedQuestions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireId as string
      },
      orderBy: {
        rowIndex: "asc"
      },
      select: {
        id: true,
        reviewStatus: true,
        approvedAnswer: {
          select: {
            answerText: true,
            citationChunkIds: true
          }
        }
      }
    });

    expect(refreshedQuestions[0].reviewStatus).toBe("DRAFT");
    expect(refreshedQuestions[0].approvedAnswer).toBeNull();
    expect(refreshedQuestions[1].reviewStatus).toBe("APPROVED");
    expect(refreshedQuestions[1].approvedAnswer?.answerText).toBe(editedApprovedAnswerText);
    expect(refreshedQuestions[1].approvedAnswer?.citationChunkIds).toEqual([chunkIds.ssoChunkId]);
    expect(refreshedQuestions[2].reviewStatus).toBe("NEEDS_REVIEW");
    expect(refreshedQuestions[2].approvedAnswer).toBeNull();

    const detailsResponse = await questionnaireDetailsRoute(new Request("http://localhost"), {
      params: {
        id: questionnaireId as string
      }
    });
    const detailsPayload = (await detailsResponse.json()) as {
      questions: Array<{
        reviewStatus?: string;
        approvedAnswer?: {
          id?: string;
          answerText?: string;
          citationChunkIds?: string[];
        } | null;
      }>;
    };

    expect(detailsResponse.status).toBe(200);
    expect(detailsPayload.questions).toHaveLength(3);
    expect(detailsPayload.questions[0].reviewStatus).toBe("DRAFT");
    expect(detailsPayload.questions[0].approvedAnswer).toBeNull();
    expect(detailsPayload.questions[1].reviewStatus).toBe("APPROVED");
    expect(detailsPayload.questions[1].approvedAnswer?.answerText).toBe(editedApprovedAnswerText);
    expect(detailsPayload.questions[1].approvedAnswer?.citationChunkIds).toEqual([chunkIds.ssoChunkId]);
    expect(detailsPayload.questions[2].reviewStatus).toBe("NEEDS_REVIEW");
    expect(detailsPayload.questions[2].approvedAnswer).toBeNull();
  });

  it("reuses approved answers across questionnaires via exact and semantic question matching", async () => {
    const organization = await getOrCreateDefaultOrganization();
    const chunkIds = await seedEvidenceChunksForOrganization(organization.id);

    createEmbeddingMock.mockImplementation(async (input: string) => {
      const question = input.toLowerCase();
      if (question.includes("tls") || question.includes("transport")) {
        return sparseEmbedding(0, 1, 0.02);
      }

      if (question.includes("mfa") || question.includes("admin")) {
        return sparseEmbedding(10, 11, 0.02);
      }

      if (question.includes("iso 27001")) {
        return sparseEmbedding(30, 31, 0.02);
      }

      return sparseEmbedding(100);
    });

    const questionnaireACsv =
      "Control ID,Question\n" +
      "A-1,What minimum TLS version is required for public APIs?\n" +
      "A-2,Is MFA required for privileged administrative access?\n";

    const questionnaireAFormData = new FormData();
    questionnaireAFormData.append("file", new File([questionnaireACsv], "reuse-a.csv", { type: "text/csv" }));
    questionnaireAFormData.append("questionColumn", "Question");
    questionnaireAFormData.append("name", `${TEST_QUESTIONNAIRE_NAME_PREFIX}reuse-a-${Date.now()}`);

    const importAResponse = await importRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: questionnaireAFormData
      })
    );
    expect(importAResponse.status).toBe(201);
    const importAPayload = (await importAResponse.json()) as {
      questionnaire?: { id: string };
    };
    const questionnaireAId = importAPayload.questionnaire?.id;
    expect(questionnaireAId).toBeTruthy();

    answerQuestionMock
      .mockResolvedValueOnce({
        answer: "Minimum TLS version is 1.2 for public APIs.",
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.tlsChunkId,
            quotedSnippet: "External traffic requires TLS 1.2 or higher."
          }
        ]
      })
      .mockResolvedValueOnce({
        answer: "MFA is required for privileged administrative access.",
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.ssoChunkId,
            quotedSnippet: "Single sign-on is supported for workforce identity providers."
          }
        ]
      });

    const autofillAResponse = await autofillRoute(new Request("http://localhost"), {
      params: { id: questionnaireAId as string }
    });
    expect(autofillAResponse.status).toBe(200);
    expect(answerQuestionMock).toHaveBeenCalledTimes(2);

    const questionnaireAQuestions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireAId as string
      },
      orderBy: {
        rowIndex: "asc"
      },
      select: {
        id: true
      }
    });
    expect(questionnaireAQuestions).toHaveLength(2);

    const approveA1Response = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: questionnaireAQuestions[0].id
        })
      })
    );
    expect(approveA1Response.status).toBe(200);
    const approveA1Payload = (await approveA1Response.json()) as {
      approvedAnswer?: { id: string };
    };
    expect(approveA1Payload.approvedAnswer?.id).toBeTruthy();

    const approveA2Response = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: questionnaireAQuestions[1].id
        })
      })
    );
    expect(approveA2Response.status).toBe(200);
    const approveA2Payload = (await approveA2Response.json()) as {
      approvedAnswer?: { id: string };
    };
    expect(approveA2Payload.approvedAnswer?.id).toBeTruthy();

    const questionnaireBCsv =
      "Control ID,Question\n" +
      "B-1,What minimum TLS version is required for public APIs?\n" +
      "B-2,Do you enforce MFA for admin consoles?\n" +
      "B-3,Are you ISO 27001 certified?\n";

    const questionnaireBFormData = new FormData();
    questionnaireBFormData.append("file", new File([questionnaireBCsv], "reuse-b.csv", { type: "text/csv" }));
    questionnaireBFormData.append("questionColumn", "Question");
    questionnaireBFormData.append("name", `${TEST_QUESTIONNAIRE_NAME_PREFIX}reuse-b-${Date.now()}`);

    const importBResponse = await importRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: questionnaireBFormData
      })
    );
    expect(importBResponse.status).toBe(201);
    const importBPayload = (await importBResponse.json()) as {
      questionnaire?: { id: string };
    };
    const questionnaireBId = importBPayload.questionnaire?.id;
    expect(questionnaireBId).toBeTruthy();

    answerQuestionMock.mockReset();
    answerQuestionMock.mockResolvedValue({
      answer: "Not found in provided documents.",
      citations: []
    });

    const autofillBResponse = await autofillRoute(new Request("http://localhost"), {
      params: { id: questionnaireBId as string }
    });
    expect(autofillBResponse.status).toBe(200);
    const autofillBPayload = (await autofillBResponse.json()) as {
      totalCount: number;
      answeredCount: number;
      foundCount: number;
      notFoundCount: number;
      reusedCount: number;
      reusedFromApprovedAnswers: Array<{ reusedFromApprovedAnswerId: string; matchType: string }>;
    };

    expect(autofillBPayload.totalCount).toBe(3);
    expect(autofillBPayload.answeredCount).toBe(3);
    expect(autofillBPayload.foundCount).toBe(2);
    expect(autofillBPayload.notFoundCount).toBe(1);
    expect(autofillBPayload.reusedCount).toBe(2);
    expect(autofillBPayload.reusedFromApprovedAnswers).toHaveLength(2);
    expect(
      autofillBPayload.reusedFromApprovedAnswers.map((entry) => entry.reusedFromApprovedAnswerId)
    ).toEqual(expect.arrayContaining([approveA1Payload.approvedAnswer?.id, approveA2Payload.approvedAnswer?.id]));
    expect(
      autofillBPayload.reusedFromApprovedAnswers.map((entry) => entry.matchType)
    ).toEqual(expect.arrayContaining(["exact", "semantic"]));

    expect(answerQuestionMock).toHaveBeenCalledTimes(1);
    expect(answerQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        questionText: "Are you ISO 27001 certified?"
      })
    );

    const questionnaireBQuestions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireBId as string
      },
      orderBy: {
        rowIndex: "asc"
      },
      select: {
        text: true,
        answer: true,
        citations: true
      }
    });

    const byText = new Map(questionnaireBQuestions.map((row) => [row.text, row]));

    const tlsRow = byText.get("What minimum TLS version is required for public APIs?");
    expect(tlsRow?.answer).toContain("1.2");
    expect(Array.isArray(tlsRow?.citations)).toBe(true);
    expect((tlsRow?.citations as Array<unknown>).length).toBeGreaterThan(0);

    const mfaRow = byText.get("Do you enforce MFA for admin consoles?");
    expect(mfaRow?.answer).toContain("MFA");
    expect(Array.isArray(mfaRow?.citations)).toBe(true);
    expect((mfaRow?.citations as Array<unknown>).length).toBeGreaterThan(0);

    const isoRow = byText.get("Are you ISO 27001 certified?");
    expect(isoRow?.answer).toBe("Not found in provided documents.");
    expect(isoRow?.citations).toEqual([]);
  });

  it("export mode supports preferApproved, approvedOnly, and generated", async () => {
    const organization = await getOrCreateDefaultOrganization();
    const chunkIds = await seedEvidenceChunksForOrganization(organization.id);

    const csvContent =
      "Control ID,Question\n" +
      "Q-1,What minimum TLS version is required?\n" +
      "Q-2,Do you support SSO?\n";

    const formData = new FormData();
    formData.append("file", new File([csvContent], "approval-export.csv", { type: "text/csv" }));
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

    const generatedTlsAnswer = "Generated TLS answer: minimum version is TLS 1.2.";
    const generatedSsoAnswer = "Generated SSO answer: SSO is supported.";
    const approvedTlsAnswer = "Approved TLS answer: minimum version is TLS 1.2+.";

    answerQuestionMock
      .mockResolvedValueOnce({
        answer: generatedTlsAnswer,
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.tlsChunkId,
            quotedSnippet: "External traffic requires TLS 1.2 or higher."
          }
        ]
      })
      .mockResolvedValueOnce({
        answer: generatedSsoAnswer,
        citations: [
          {
            docName: "Workflow Evidence",
            chunkId: chunkIds.ssoChunkId,
            quotedSnippet: "Single sign-on is supported for workforce identity providers."
          }
        ]
      });

    const autofillResponse = await autofillRoute(new Request("http://localhost"), {
      params: { id: questionnaireId as string }
    });
    expect(autofillResponse.status).toBe(200);

    const questions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireId as string
      },
      orderBy: {
        rowIndex: "asc"
      },
      select: {
        id: true
      }
    });

    const approvalResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: questions[0].id
        })
      })
    );
    const approvalPayload = (await approvalResponse.json()) as {
      approvedAnswer?: { id: string };
    };
    expect(approvalResponse.status).toBe(200);

    const patchResponse = await approvedAnswersPatchRoute(
      new Request(`http://localhost/api/approved-answers/${approvalPayload.approvedAnswer?.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: approvedTlsAnswer,
          citationChunkIds: [chunkIds.tlsChunkId]
        })
      }),
      {
        params: {
          id: approvalPayload.approvedAnswer?.id as string
        }
      }
    );
    expect(patchResponse.status).toBe(200);

    const preferApprovedExportResponse = await exportRoute(
      new Request(`http://localhost/api/questionnaires/${questionnaireId}/export`),
      {
        params: {
          id: questionnaireId as string
        }
      }
    );
    expect(preferApprovedExportResponse.status).toBe(200);
    const preferApprovedCsv = parseCsvText(await preferApprovedExportResponse.text());
    const preferRowOne = preferApprovedCsv.rows.find((row) => row["Control ID"] === "Q-1");
    const preferRowTwo = preferApprovedCsv.rows.find((row) => row["Control ID"] === "Q-2");
    expect(preferRowOne?.Answer).toBe(approvedTlsAnswer);
    expect(preferRowTwo?.Answer).toBe(generatedSsoAnswer);

    const approvedOnlyExportResponse = await exportRoute(
      new Request(`http://localhost/api/questionnaires/${questionnaireId}/export?mode=approvedOnly`),
      {
        params: {
          id: questionnaireId as string
        }
      }
    );
    expect(approvedOnlyExportResponse.status).toBe(200);
    const approvedOnlyCsv = parseCsvText(await approvedOnlyExportResponse.text());
    const approvedOnlyRowOne = approvedOnlyCsv.rows.find((row) => row["Control ID"] === "Q-1");
    const approvedOnlyRowTwo = approvedOnlyCsv.rows.find((row) => row["Control ID"] === "Q-2");
    expect(approvedOnlyRowOne?.Answer).toBe(approvedTlsAnswer);
    expect(approvedOnlyRowTwo?.Answer).toBe("");
    expect(approvedOnlyRowTwo?.Citations).toBe("");

    const generatedExportResponse = await exportRoute(
      new Request(`http://localhost/api/questionnaires/${questionnaireId}/export?mode=generated`),
      {
        params: {
          id: questionnaireId as string
        }
      }
    );
    expect(generatedExportResponse.status).toBe(200);
    const generatedCsv = parseCsvText(await generatedExportResponse.text());
    const generatedRowOne = generatedCsv.rows.find((row) => row["Control ID"] === "Q-1");
    const generatedRowTwo = generatedCsv.rows.find((row) => row["Control ID"] === "Q-2");
    expect(generatedRowOne?.Answer).toBe(generatedTlsAnswer);
    expect(generatedRowTwo?.Answer).toBe(generatedSsoAnswer);
  });

  it("rejects approval when citation chunk IDs are from a different organization", async () => {
    const csvContent = "Control ID,Question\nQ-1,Do you support SSO?\n";
    const formData = new FormData();
    formData.append("file", new File([csvContent], "cross-org.csv", { type: "text/csv" }));
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

    const question = await prisma.question.findFirst({
      where: {
        questionnaireId: questionnaireId as string
      },
      select: {
        id: true
      }
    });
    expect(question?.id).toBeTruthy();

    const foreignOrganization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_NAME_PREFIX}${Date.now()}`
      }
    });

    const foreignDocument = await prisma.document.create({
      data: {
        organizationId: foreignOrganization.id,
        name: `${TEST_DOCUMENT_NAME_PREFIX}${Date.now()}-foreign`,
        originalName: "foreign.txt",
        mimeType: "text/plain",
        status: "CHUNKED"
      }
    });

    const foreignChunk = await prisma.documentChunk.create({
      data: {
        documentId: foreignDocument.id,
        chunkIndex: 0,
        content: "Foreign organization evidence."
      }
    });

    const approvalResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: question?.id,
          answerText: "Manual approved answer.",
          citationChunkIds: [foreignChunk.id],
          source: "MANUAL_EDIT"
        })
      })
    );
    const approvalPayload = (await approvalResponse.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };

    expect(approvalResponse.status).toBe(400);
    expect(approvalPayload.error?.code).toBe("VALIDATION_ERROR");
  });
});
