import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as documentsListRoute } from "@/app/api/documents/route";
import { POST as documentsUploadRoute } from "@/app/api/documents/upload/route";
import { POST as documentsEmbedRoute } from "@/app/api/documents/embed/route";
import { POST as approvedAnswersCreateRoute } from "@/app/api/approved-answers/route";
import { POST as questionnaireAutofillRoute } from "@/app/api/questionnaires/[id]/autofill/route";
import { GET as questionnaireDetailsRoute } from "@/app/api/questionnaires/[id]/route";
import { POST as questionnaireImportRoute } from "@/app/api/questionnaires/import/route";
import { POST as questionAnswerRoute } from "@/app/api/questions/answer/route";
import { prisma } from "@/lib/prisma";
import type { RequestContext } from "@/lib/requestContext";
import { seedUserWithTwoOrganizations, setActiveOrgForUser } from "@/test/orgContextTestUtils";

const {
  createEmbeddingMock,
  generateEvidenceSufficiencyMock,
  generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiencyMock,
  getRequestContextMock,
  MockRequestContextError
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  getRequestContextMock: vi.fn(),
  MockRequestContextError: class MockRequestContextError extends Error {
    code: string;
    status: number;

    constructor(message: string, options: { code: string; status: number }) {
      super(message);
      this.code = options.code;
      this.status = options.status;
    }
  }
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiency: generateLegacyEvidenceSufficiencyMock
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock,
  RequestContextError: MockRequestContextError
}));

const TEST_USER_PREFIX = "vitest-org-scope-user-";
const TEST_ORG_PREFIX = "vitest-org-scope-org-";
const TEST_DOC_PREFIX = "vitest-org-scope-doc-";
const TEST_Q_PREFIX = "vitest-org-scope-q-";
const NOT_FOUND_TEXT = "Not found in provided documents.";

type SeededTenantData = {
  userId: string;
  orgAId: string;
  orgBId: string;
};

let seeded: SeededTenantData | null = null;
let currentContext: RequestContext | null = null;

async function cleanupOrganizationData(organizationId: string) {
  await prisma.approvedAnswer.deleteMany({
    where: {
      organizationId
    }
  });
  await prisma.question.deleteMany({
    where: {
      questionnaire: {
        organizationId
      }
    }
  });
  await prisma.questionnaire.deleteMany({
    where: {
      organizationId
    }
  });
  await prisma.documentChunk.deleteMany({
    where: {
      document: {
        organizationId
      }
    }
  });
  await prisma.document.deleteMany({
    where: {
      organizationId
    }
  });
}

async function switchActiveContext(params: { userId: string; orgId: string }): Promise<RequestContext> {
  const context = await setActiveOrgForUser({
    userId: params.userId,
    orgId: params.orgId,
    role: MembershipRole.OWNER
  });
  currentContext = context;
  return context;
}

function buildCsvImportForm(params: { name: string; questions: string[] }) {
  const csvBody = ["Control ID,Question", ...params.questions.map((question, index) => `Q-${index + 1},${question}`)].join(
    "\n"
  );
  const formData = new FormData();
  formData.append("file", new File([csvBody], "tenant.csv", { type: "text/csv" }));
  formData.append("questionColumn", "Question");
  formData.append("name", params.name);
  return formData;
}

async function uploadAndEmbedEvidence() {
  const fixturePath = join(process.cwd(), "test/fixtures/template_evidence_pack.txt");
  const evidenceText = readFileSync(fixturePath, "utf8");

  const uploadForm = new FormData();
  uploadForm.append(
    "file",
    new File([evidenceText], `${TEST_DOC_PREFIX}${Date.now()}.txt`, { type: "text/plain" })
  );

  const uploadResponse = await documentsUploadRoute(
    new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body: uploadForm
    })
  );
  expect(uploadResponse.status).toBe(201);

  const embedResponse = await documentsEmbedRoute(
    new Request("http://localhost/api/documents/embed", {
      method: "POST"
    })
  );
  expect(embedResponse.status).toBe(200);
}

describe.sequential("organization scoping isolation", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";

    createEmbeddingMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    getRequestContextMock.mockReset();

    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.015));
    generateGroundedAnswerMock.mockResolvedValue({
      answer: NOT_FOUND_TEXT,
      citations: [],
      confidence: "low",
      needsReview: true
    });
    generateLegacyEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: false,
      missingPoints: ["legacy gate disabled in this test"],
      supportingChunkIds: []
    });
    generateEvidenceSufficiencyMock.mockImplementation(
      async (params: { question: string; snippets: Array<{ chunkId: string }> }) => {
        const normalizedQuestion = params.question.toLowerCase();
        const supportingChunkIds = params.snippets[0]?.chunkId ? [params.snippets[0].chunkId] : [];

        if (normalizedQuestion.includes("iso 27001")) {
          return {
            requirements: ["ISO 27001 certification"],
            extracted: [
              {
                requirement: "ISO 27001 certification",
                value: null,
                supportingChunkIds: []
              }
            ],
            overall: "NOT_FOUND",
            hadShapeRepair: false,
            extractorInvalid: false,
            invalidReason: null
          };
        }

        if (supportingChunkIds.length === 0) {
          return {
            requirements: ["Evidence support"],
            extracted: [
              {
                requirement: "Evidence support",
                value: null,
                supportingChunkIds: []
              }
            ],
            overall: "NOT_FOUND",
            hadShapeRepair: false,
            extractorInvalid: false,
            invalidReason: null
          };
        }

        return {
          requirements: ["Evidence support"],
          extracted: [
            {
              requirement: "Evidence support",
              value: "Supported by provided documents.",
              supportingChunkIds
            }
          ],
          overall: "FOUND",
          hadShapeRepair: false,
          extractorInvalid: false,
          invalidReason: null
        };
      }
    );

    seeded = await seedUserWithTwoOrganizations({
      emailPrefix: TEST_USER_PREFIX,
      orgPrefix: TEST_ORG_PREFIX
    });
    await setActiveOrgForUser({
      userId: seeded.userId,
      orgId: seeded.orgBId,
      role: MembershipRole.OWNER
    });
    currentContext = await switchActiveContext({
      userId: seeded.userId,
      orgId: seeded.orgAId
    });

    getRequestContextMock.mockImplementation(async () => {
      if (currentContext) {
        return currentContext;
      }

      throw new MockRequestContextError("Authentication required.", {
        code: "UNAUTHORIZED",
        status: 401
      });
    });
  });

  afterEach(async () => {
    if (seeded) {
      await cleanupOrganizationData(seeded.orgAId);
      await cleanupOrganizationData(seeded.orgBId);
      await prisma.membership.deleteMany({
        where: {
          userId: seeded.userId
        }
      });
      await prisma.user.delete({
        where: {
          id: seeded.userId
        }
      });
      await prisma.organization.deleteMany({
        where: {
          id: {
            in: [seeded.orgAId, seeded.orgBId]
          }
        }
      });
    }

    seeded = null;
    currentContext = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("isolates documents/questionnaires/answering and blocks cross-org approved-answer reuse", async () => {
    if (!seeded) {
      throw new Error("Expected test seed state to be initialized.");
    }

    await uploadAndEmbedEvidence();

    const importAResponse = await questionnaireImportRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: buildCsvImportForm({
          name: `${TEST_Q_PREFIX}a-${Date.now()}`,
          questions: [
            "What minimum TLS version is required for external traffic?",
            "Are you ISO 27001 certified?"
          ]
        })
      })
    );
    expect(importAResponse.status).toBe(201);
    const importAPayload = (await importAResponse.json()) as {
      questionnaire?: {
        id: string;
      };
    };
    const questionnaireAId = importAPayload.questionnaire?.id;
    expect(questionnaireAId).toBeTruthy();

    const autofillAResponse = await questionnaireAutofillRoute(
      new Request("http://localhost/api/questionnaires/autofill", { method: "POST" }),
      {
        params: {
          id: questionnaireAId as string
        }
      }
    );
    expect(autofillAResponse.status).toBe(200);

    const orgAQuestions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireAId as string
      },
      orderBy: {
        rowIndex: "asc"
      },
      select: {
        id: true,
        text: true,
        answer: true,
        citations: true
      }
    });
    const tlsQuestion = orgAQuestions.find((question) => question.text.toLowerCase().includes("minimum tls"));
    expect(tlsQuestion?.answer).not.toBe(NOT_FOUND_TEXT);
    const createApprovedAnswerResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: tlsQuestion?.id
        })
      })
    );
    expect(createApprovedAnswerResponse.status).toBe(200);

    await switchActiveContext({
      userId: seeded.userId,
      orgId: seeded.orgBId
    });

    const documentsBResponse = await documentsListRoute();
    expect(documentsBResponse.status).toBe(200);
    const documentsBPayload = (await documentsBResponse.json()) as {
      documents: Array<{ id: string }>;
    };
    expect(documentsBPayload.documents).toEqual([]);

    const crossOrgQuestionnaireResponse = await questionnaireDetailsRoute(
      new Request("http://localhost/api/questionnaires", { method: "GET" }),
      {
        params: {
          id: questionnaireAId as string
        }
      }
    );
    expect(crossOrgQuestionnaireResponse.status).toBe(404);

    const answerInOrgBResponse = await questionAnswerRoute(
      new Request("http://localhost/api/questions/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: "What minimum TLS version is required for external traffic?"
        })
      })
    );
    expect(answerInOrgBResponse.status).toBe(200);
    const answerInOrgBPayload = (await answerInOrgBResponse.json()) as {
      answer: string;
      citations: Array<{ chunkId: string }>;
    };
    expect(answerInOrgBPayload.answer).toBe(NOT_FOUND_TEXT);
    expect(answerInOrgBPayload.citations).toEqual([]);

    await uploadAndEmbedEvidence();

    const importBResponse = await questionnaireImportRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: buildCsvImportForm({
          name: `${TEST_Q_PREFIX}b-${Date.now()}`,
          questions: [
            "What minimum TLS version is required for external traffic?",
            "Do you enforce MFA for admin consoles?"
          ]
        })
      })
    );
    expect(importBResponse.status).toBe(201);
    const importBPayload = (await importBResponse.json()) as {
      questionnaire?: {
        id: string;
      };
    };
    const questionnaireBId = importBPayload.questionnaire?.id;
    expect(questionnaireBId).toBeTruthy();

    const autofillBResponse = await questionnaireAutofillRoute(
      new Request("http://localhost/api/questionnaires/autofill", { method: "POST" }),
      {
        params: {
          id: questionnaireBId as string
        }
      }
    );
    expect(autofillBResponse.status).toBe(200);
    const autofillBPayload = (await autofillBResponse.json()) as {
      reusedCount: number;
      reusedFromApprovedAnswers: Array<{ reusedFromApprovedAnswerId: string }>;
    };
    expect(autofillBPayload.reusedCount).toBe(0);
    expect(autofillBPayload.reusedFromApprovedAnswers).toEqual([]);

    const questionnaireBDetailsResponse = await questionnaireDetailsRoute(
      new Request("http://localhost/api/questionnaires", { method: "GET" }),
      {
        params: {
          id: questionnaireBId as string
        }
      }
    );
    expect(questionnaireBDetailsResponse.status).toBe(200);
    const questionnaireBDetailsPayload = (await questionnaireBDetailsResponse.json()) as {
      questions: Array<{ reusedFromApprovedAnswerId: string | null }>;
    };
    for (const question of questionnaireBDetailsPayload.questions) {
      expect(question.reusedFromApprovedAnswerId).toBeNull();
    }
  });
});
