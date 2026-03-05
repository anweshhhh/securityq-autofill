import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as approvedAnswersCreateRoute } from "@/app/api/approved-answers/route";
import { POST as documentsEmbedRoute } from "@/app/api/documents/embed/route";
import { POST as documentsUploadRoute } from "@/app/api/documents/upload/route";
import { GET as questionnaireExportRoute } from "@/app/api/questionnaires/[id]/export/route";
import { POST as questionnaireAutofillRoute } from "@/app/api/questionnaires/[id]/autofill/route";
import { POST as questionnaireImportRoute } from "@/app/api/questionnaires/import/route";
import { prisma } from "@/lib/prisma";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { setActiveOrgForUser } from "@/test/orgContextTestUtils";

const {
  createEmbeddingMock,
  generateEvidenceSufficiencyMock,
  generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiencyMock,
  getEmbeddingAvailabilityMock,
  processQuestionnaireAutofillBatchMock,
  getRequestContextMock,
  MockRequestContextError
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  getEmbeddingAvailabilityMock: vi.fn(),
  processQuestionnaireAutofillBatchMock: vi.fn(),
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

vi.mock("@/lib/questionnaireService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/questionnaireService")>(
    "@/lib/questionnaireService"
  );
  return {
    ...actual,
    getEmbeddingAvailability: getEmbeddingAvailabilityMock,
    processQuestionnaireAutofillBatch: processQuestionnaireAutofillBatchMock
  };
});

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock,
  RequestContextError: MockRequestContextError
}));

type TestContext = {
  userId: string;
  orgId: string;
  role: MembershipRole;
};

type SeededState = {
  userId: string;
  orgId: string;
};

const TEST_EMAIL_PREFIX = "vitest-rbac-user-";
const TEST_ORG_PREFIX = "vitest-rbac-org-";
const TEST_DOC_PREFIX = "vitest-rbac-doc-";
const TEST_Q_PREFIX = "vitest-rbac-q-";

let seeded: SeededState | null = null;
let currentContext: TestContext | null = null;

async function cleanupOrganizationData(orgId: string) {
  await prisma.approvedAnswer.deleteMany({
    where: {
      organizationId: orgId
    }
  });
  await prisma.question.deleteMany({
    where: {
      questionnaire: {
        organizationId: orgId
      }
    }
  });
  await prisma.questionnaire.deleteMany({
    where: {
      organizationId: orgId
    }
  });
  await prisma.documentChunk.deleteMany({
    where: {
      document: {
        organizationId: orgId
      }
    }
  });
  await prisma.document.deleteMany({
    where: {
      organizationId: orgId
    }
  });
}

async function setRole(role: MembershipRole): Promise<TestContext> {
  if (!seeded) {
    throw new Error("Missing seeded state.");
  }

  const context = await setActiveOrgForUser({
    userId: seeded.userId,
    orgId: seeded.orgId,
    role
  });
  currentContext = {
    userId: context.userId,
    orgId: context.orgId,
    role: context.role
  };
  return currentContext;
}

async function seedQuestionnaireWithCitation(orgId: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const document = await prisma.document.create({
    data: {
      organizationId: orgId,
      name: `${TEST_DOC_PREFIX}${suffix}`,
      originalName: "rbac-evidence.txt",
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      content: "External traffic requires TLS 1.2 or higher. MFA is required for administrators.",
      evidenceFingerprint: computeEvidenceFingerprint(
        "External traffic requires TLS 1.2 or higher. MFA is required for administrators."
      )
    }
  });

  const questionnaire = await prisma.questionnaire.create({
    data: {
      organizationId: orgId,
      name: `${TEST_Q_PREFIX}${suffix}`,
      sourceFileName: "rbac.csv",
      questionColumn: "Question",
      sourceHeaders: ["Question"],
      totalCount: 1
    }
  });

  const question = await prisma.question.create({
    data: {
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      sourceRow: {
        Question: "What minimum TLS version is required?"
      },
      text: "What minimum TLS version is required?",
      answer: "External traffic requires TLS 1.2 or higher.",
      citations: [
        {
          docName: document.name,
          chunkId: chunk.id,
          quotedSnippet: chunk.content
        }
      ]
    }
  });

  return {
    questionnaireId: questionnaire.id,
    questionId: question.id,
    chunkId: chunk.id
  };
}

function buildCsvImportForm(name: string) {
  const csvBody = ["Control ID,Question", "Q-1,What minimum TLS version is required?"].join("\n");
  const formData = new FormData();
  formData.append("file", new File([csvBody], "rbac-import.csv", { type: "text/csv" }));
  formData.append("questionColumn", "Question");
  formData.append("name", name);
  return formData;
}

describe.sequential("RBAC permissions matrix enforcement", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";

    createEmbeddingMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    getEmbeddingAvailabilityMock.mockReset();
    processQuestionnaireAutofillBatchMock.mockReset();
    getRequestContextMock.mockReset();

    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));
    generateEvidenceSufficiencyMock.mockResolvedValue({
      requirements: ["Evidence support"],
      extracted: [
        {
          requirement: "Evidence support",
          value: "Supported by evidence.",
          supportingChunkIds: []
        }
      ],
      overall: "FOUND",
      hadShapeRepair: false,
      extractorInvalid: false,
      invalidReason: null
    });
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Supported by evidence.",
      citations: [],
      confidence: "low",
      needsReview: true
    });
    generateLegacyEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: true,
      missingPoints: [],
      supportingChunkIds: []
    });
    getEmbeddingAvailabilityMock.mockResolvedValue({
      total: 1,
      embedded: 1,
      missing: 0
    });
    processQuestionnaireAutofillBatchMock.mockResolvedValue({
      questionnaireId: "mocked",
      totalCount: 1,
      answeredCount: 1,
      foundCount: 1,
      notFoundCount: 0
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const user = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`
      }
    });
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${suffix}`
      }
    });

    seeded = {
      userId: user.id,
      orgId: organization.id
    };

    await setRole(MembershipRole.OWNER);

    getRequestContextMock.mockImplementation(async () => {
      if (!currentContext) {
        throw new MockRequestContextError("Authentication required.", {
          code: "UNAUTHORIZED",
          status: 401
        });
      }
      return currentContext;
    });
  });

  afterEach(async () => {
    if (seeded) {
      await cleanupOrganizationData(seeded.orgId);
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
      await prisma.organization.delete({
        where: {
          id: seeded.orgId
        }
      });
    }

    seeded = null;
    currentContext = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("VIEWER cannot upload documents but can export questionnaires", async () => {
    if (!seeded) {
      throw new Error("Missing seeded test state.");
    }

    const seededArtifacts = await seedQuestionnaireWithCitation(seeded.orgId);
    await setRole(MembershipRole.VIEWER);

    const uploadForm = new FormData();
    uploadForm.append("file", new File(["Viewer upload check"], "viewer.txt", { type: "text/plain" }));
    const uploadResponse = await documentsUploadRoute(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: uploadForm
      })
    );
    expect(uploadResponse.status).toBe(403);
    const uploadPayload = (await uploadResponse.json()) as {
      error?: { code?: string; requiredRole?: string };
    };
    expect(uploadPayload.error?.code).toBe("FORBIDDEN_ROLE");
    expect(uploadPayload.error?.requiredRole).toBe("ADMIN");

    const exportResponse = await questionnaireExportRoute(
      new Request(`http://localhost/api/questionnaires/${seededArtifacts.questionnaireId}/export`, {
        method: "GET"
      }),
      {
        params: {
          id: seededArtifacts.questionnaireId
        }
      }
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
  });

  it("REVIEWER can approve answers but cannot import questionnaires", async () => {
    if (!seeded) {
      throw new Error("Missing seeded test state.");
    }

    const seededArtifacts = await seedQuestionnaireWithCitation(seeded.orgId);
    await setRole(MembershipRole.REVIEWER);

    const approveResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: seededArtifacts.questionId,
          answerText: "External traffic requires TLS 1.2 or higher.",
          citationChunkIds: [seededArtifacts.chunkId],
          source: "GENERATED"
        })
      })
    );
    expect(approveResponse.status).toBe(200);
    const approvePayload = (await approveResponse.json()) as {
      approvedAnswer?: { id?: string; citationChunkIds?: string[] };
    };
    expect(typeof approvePayload.approvedAnswer?.id).toBe("string");
    expect(approvePayload.approvedAnswer?.citationChunkIds).toEqual([seededArtifacts.chunkId]);

    const importResponse = await questionnaireImportRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: buildCsvImportForm(`${TEST_Q_PREFIX}reviewer`)
      })
    );
    expect(importResponse.status).toBe(403);
    const importPayload = (await importResponse.json()) as {
      error?: { code?: string; requiredRole?: string };
    };
    expect(importPayload.error?.code).toBe("FORBIDDEN_ROLE");
    expect(importPayload.error?.requiredRole).toBe("ADMIN");
  });

  it("ADMIN can upload, embed, import, and run autofill", async () => {
    if (!seeded) {
      throw new Error("Missing seeded test state.");
    }

    await setRole(MembershipRole.ADMIN);

    const uploadForm = new FormData();
    uploadForm.append(
      "file",
      new File(
        ["External traffic requires TLS 1.2 or higher. Administrators must use MFA."],
        "admin-evidence.txt",
        { type: "text/plain" }
      )
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

    const importResponse = await questionnaireImportRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: buildCsvImportForm(`${TEST_Q_PREFIX}admin`)
      })
    );
    expect(importResponse.status).toBe(201);
    const importPayload = (await importResponse.json()) as {
      questionnaire?: {
        id?: string;
      };
    };
    const questionnaireId = importPayload.questionnaire?.id;
    expect(typeof questionnaireId).toBe("string");

    const autofillResponse = await questionnaireAutofillRoute(
      new Request(`http://localhost/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      }),
      {
        params: {
          id: questionnaireId as string
        }
      }
    );
    expect(autofillResponse.status).toBe(200);
    expect(processQuestionnaireAutofillBatchMock).toHaveBeenCalledWith({
      organizationId: seeded.orgId,
      questionnaireId,
      debug: false
    });
  });
});
