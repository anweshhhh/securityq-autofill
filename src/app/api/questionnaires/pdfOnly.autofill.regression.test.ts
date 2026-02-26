import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as uploadRoute } from "@/app/api/documents/upload/route";
import { POST as embedRoute } from "@/app/api/documents/embed/route";
import { POST as importRoute } from "@/app/api/questionnaires/import/route";
import { POST as autofillRoute } from "@/app/api/questionnaires/[id]/autofill/route";

const {
  createEmbeddingMock,
  generateEvidenceSufficiencyMock,
  generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiencyMock,
  getOrCreateDefaultOrganizationMock
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  getOrCreateDefaultOrganizationMock: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateLegacyEvidenceSufficiency: generateLegacyEvidenceSufficiencyMock
}));

vi.mock("@/lib/defaultOrg", () => ({
  getOrCreateDefaultOrganization: getOrCreateDefaultOrganizationMock
}));

const TEST_DOC_PREFIX = "vitest-template-evidence-pack-";
const TEST_Q_PREFIX = "vitest-pdf-only-autofill-";
const TEST_ORG_PREFIX = "vitest-pdf-only-org-";
const NOT_FOUND_TEXT = "Not found in provided documents.";
let isolatedOrgId: string | null = null;

function pickSupportingChunkIds(snippets: Array<{ chunkId: string }>): string[] {
  const first = snippets[0]?.chunkId;
  return first ? [first] : [];
}

async function cleanupPrefixedQuestionnaires() {
  const questionnaires = await prisma.questionnaire.findMany({
    where: {
      name: {
        startsWith: TEST_Q_PREFIX
      }
    },
    select: {
      id: true
    }
  });

  if (questionnaires.length === 0) {
    return;
  }

  const questionnaireIds = questionnaires.map((row) => row.id);

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

async function cleanupPrefixedDocuments() {
  const docs = await prisma.document.findMany({
    where: {
      originalName: {
        startsWith: TEST_DOC_PREFIX
      }
    },
    select: {
      id: true
    }
  });

  if (docs.length === 0) {
    return;
  }

  const docIds = docs.map((doc) => doc.id);

  await prisma.documentChunk.deleteMany({
    where: {
      documentId: {
        in: docIds
      }
    }
  });

  await prisma.document.deleteMany({
    where: {
      id: {
        in: docIds
      }
    }
  });
}

describe.sequential("pdf-only extractor gate questionnaire autofill regression", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";

    createEmbeddingMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();

    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));
    generateGroundedAnswerMock.mockResolvedValue({
      answer: NOT_FOUND_TEXT,
      citations: [],
      confidence: "low",
      needsReview: true
    });
    generateLegacyEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: false,
      missingPoints: ["legacy fallback disabled for this regression"],
      supportingChunkIds: []
    });
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });
    isolatedOrgId = organization.id;
    getOrCreateDefaultOrganizationMock.mockResolvedValue(organization);

    await cleanupPrefixedQuestionnaires();
    await cleanupPrefixedDocuments();
  });

  afterEach(async () => {
    await cleanupPrefixedQuestionnaires();
    await cleanupPrefixedDocuments();
    if (isolatedOrgId) {
      await prisma.approvedAnswer.deleteMany({
        where: {
          organizationId: isolatedOrgId
        }
      });
      await prisma.question.deleteMany({
        where: {
          questionnaire: {
            organizationId: isolatedOrgId
          }
        }
      });
      await prisma.questionnaire.deleteMany({
        where: {
          organizationId: isolatedOrgId
        }
      });
      await prisma.documentChunk.deleteMany({
        where: {
          document: {
            organizationId: isolatedOrgId
          }
        }
      });
      await prisma.document.deleteMany({
        where: {
          organizationId: isolatedOrgId
        }
      });
      await prisma.organization.delete({
        where: {
          id: isolatedOrgId
        }
      });
      isolatedOrgId = null;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs upload -> embed -> questionnaire autofill and keeps required checks FOUND with citations while trick checks stay strict NOT_FOUND", async () => {
    const fixturePath = join(process.cwd(), "test/fixtures/template_evidence_pack.pdf");
    const bytes = readFileSync(fixturePath);
    const pdfName = `${TEST_DOC_PREFIX}${Date.now()}.pdf`;

    const uploadFormData = new FormData();
    uploadFormData.append("file", new File([bytes], pdfName, { type: "application/pdf" }));
    const uploadResponse = await uploadRoute(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: uploadFormData
      })
    );
    expect(uploadResponse.status).toBe(201);

    const embedResponse = await embedRoute(new Request("http://localhost/api/documents/embed", { method: "POST" }));
    expect(embedResponse.status).toBe(200);

    const csvContent =
      "Category,Question\n" +
      "IAM,Is production access restricted to authorized personnel and granted via least privilege?\n" +
      "Encryption,What minimum TLS version is required for external traffic?\n" +
      "Encryption,Is data encrypted at rest using AES-256 and managed through KMS?\n" +
      "Compliance,Do you maintain a current SOC 2 Type II report and which TSC are covered?\n" +
      "Trick,What FedRAMP authorization level has been granted?\n" +
      "Trick,What is your annual HIPAA external attestation date?\n";

    const importFormData = new FormData();
    importFormData.append("file", new File([csvContent], "pdf-only-regression.csv", { type: "text/csv" }));
    importFormData.append("questionColumn", "Question");
    importFormData.append("name", `${TEST_Q_PREFIX}${Date.now()}`);

    const importResponse = await importRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: importFormData
      })
    );
    expect(importResponse.status).toBe(201);
    const importPayload = (await importResponse.json()) as {
      questionnaire?: {
        id: string;
      };
    };
    const questionnaireId = importPayload.questionnaire?.id;
    expect(questionnaireId).toBeTruthy();

    generateEvidenceSufficiencyMock.mockImplementation(
      async (params: { question: string; snippets: Array<{ chunkId: string }> }) => {
        const question = params.question.toLowerCase();
        const supportingChunkIds = pickSupportingChunkIds(params.snippets);

        if (question.includes("least privilege") || question.includes("production access")) {
          return {
            requirements: ["Production access restriction", "Least privilege"],
            extracted: [
              {
                requirement: "Production access restriction",
                value: "Production access is restricted to authorized personnel.",
                supportingChunkIds
              },
              {
                requirement: "Least privilege",
                value: "Access is granted via least privilege principles.",
                supportingChunkIds
              }
            ],
            overall: "FOUND",
            hadShapeRepair: false,
            extractorInvalid: false,
            invalidReason: null
          };
        }

        if (question.includes("minimum tls")) {
          return {
            requirements: ["Minimum TLS version"],
            extracted: [
              {
                requirement: "Minimum TLS version",
                value: "Minimum TLS version is TLS 1.2.",
                supportingChunkIds
              }
            ],
            overall: "FOUND",
            hadShapeRepair: false,
            extractorInvalid: false,
            invalidReason: null
          };
        }

        if (question.includes("aes-256") || question.includes("kms")) {
          return {
            requirements: ["AES-256 encryption at rest", "KMS key management"],
            extracted: [
              {
                requirement: "AES-256 encryption at rest",
                value: "Data at rest is encrypted with AES-256.",
                supportingChunkIds
              },
              {
                requirement: "KMS key management",
                value: "Encryption keys are managed through KMS.",
                supportingChunkIds
              }
            ],
            overall: "FOUND",
            hadShapeRepair: false,
            extractorInvalid: false,
            invalidReason: null
          };
        }

        if (question.includes("soc 2") || question.includes("tsc")) {
          return {
            requirements: ["SOC 2 Type II availability", "Covered trust services criteria"],
            extracted: [
              {
                requirement: "SOC 2 Type II availability",
                value: "A current SOC 2 Type II report is maintained.",
                supportingChunkIds
              },
              {
                requirement: "Covered trust services criteria",
                value: "Covered TSC include Security, Availability, and Confidentiality.",
                supportingChunkIds
              }
            ],
            overall: "FOUND",
            hadShapeRepair: false,
            extractorInvalid: false,
            invalidReason: null
          };
        }

        return {
          requirements: ["Requested control detail"],
          extracted: [
            {
              requirement: "Requested control detail",
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
    );

    const autofillResponse = await autofillRoute(new Request("http://localhost/api/questionnaires/autofill"), {
      params: {
        id: questionnaireId as string
      }
    });
    expect(autofillResponse.status).toBe(200);
    const autofillPayload = (await autofillResponse.json()) as {
      totalCount: number;
      answeredCount: number;
      foundCount: number;
      notFoundCount: number;
    };

    expect(autofillPayload.totalCount).toBe(6);
    expect(autofillPayload.answeredCount).toBe(6);
    expect(autofillPayload.foundCount).toBe(4);
    expect(autofillPayload.notFoundCount).toBe(2);

    const questions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaireId as string
      },
      select: {
        text: true,
        answer: true,
        citations: true
      },
      orderBy: {
        rowIndex: "asc"
      }
    });

    const byQuestion = new Map(
      questions.map((row) => [
        row.text,
        {
          answer: row.answer ?? "",
          citations: Array.isArray(row.citations) ? (row.citations as Array<{ chunkId?: string }>) : []
        }
      ])
    );

    const foundChecks = [
      "Is production access restricted to authorized personnel and granted via least privilege?",
      "What minimum TLS version is required for external traffic?",
      "Is data encrypted at rest using AES-256 and managed through KMS?",
      "Do you maintain a current SOC 2 Type II report and which TSC are covered?"
    ];

    for (const questionText of foundChecks) {
      const row = byQuestion.get(questionText);
      expect(row).toBeTruthy();
      expect(row?.answer).not.toBe(NOT_FOUND_TEXT);
      expect(row?.citations.length ?? 0).toBeGreaterThan(0);
    }

    const trickChecks = [
      "What FedRAMP authorization level has been granted?",
      "What is your annual HIPAA external attestation date?"
    ];

    for (const questionText of trickChecks) {
      const row = byQuestion.get(questionText);
      expect(row).toBeTruthy();
      expect(row?.answer).toBe(NOT_FOUND_TEXT);
      expect(row?.citations ?? []).toEqual([]);
    }
  });
});
