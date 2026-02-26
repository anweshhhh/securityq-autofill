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

const TEST_DOC_PREFIX = "vitest-parity-evidence-";
const TEST_Q_PREFIX = "vitest-parity-questionnaire-";
const TEST_ORG_PREFIX = "vitest-parity-org-";
const NOT_FOUND_TEXT = "Not found in provided documents.";

const ISO_QUESTION = "Are you ISO 27001 certified?";
const KEY_QUESTIONS = [
  "Do you enforce MFA/2FA for privileged or administrative access?",
  "Is data encrypted in transit? Specify minimum TLS version.",
  "Is data encrypted at rest for databases? Specify algorithm and key management approach.",
  "What is your RPO for critical systems?",
  "What is your RTO for critical systems?",
  "Do you have a SOC 2 Type II report? If yes, which Trust Services Criteria are covered?"
];

type ScenarioResult = {
  payload: {
    totalCount: number;
    answeredCount: number;
    foundCount: number;
    notFoundCount: number;
  };
  rowsByQuestion: Map<string, { answer: string; citations: Array<{ chunkId?: string }> }>;
};

let isolatedOrgId: string | null = null;

function pickSupportingChunkIds(snippets: Array<{ chunkId: string }>): string[] {
  const first = snippets[0]?.chunkId;
  return first ? [first] : [];
}

function toExtractorFound(params: {
  requirements: string[];
  values: string[];
  supportingChunkIds: string[];
}) {
  return {
    requirements: params.requirements,
    extracted: params.requirements.map((requirement, index) => ({
      requirement,
      value: params.values[index] ?? params.values[0] ?? "Supported by provided evidence.",
      supportingChunkIds: params.supportingChunkIds
    })),
    overall: "FOUND" as const,
    hadShapeRepair: false,
    extractorInvalid: false,
    invalidReason: null
  };
}

function toExtractorNotFound(requirement: string) {
  return {
    requirements: [requirement],
    extracted: [
      {
        requirement,
        value: null,
        supportingChunkIds: []
      }
    ],
    overall: "NOT_FOUND" as const,
    hadShapeRepair: false,
    extractorInvalid: false,
    invalidReason: null
  };
}

function snippetTextLower(snippets: Array<{ quotedSnippet: string }>): string {
  return snippets
    .map((snippet) => snippet.quotedSnippet)
    .join("\n")
    .toLowerCase();
}

function includesAll(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

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

async function runScenario(params: {
  label: "pdf" | "txt";
  fixturePath: string;
  mimeType: string;
  extension: "pdf" | "txt";
}): Promise<ScenarioResult> {
  const evidenceBytes = readFileSync(params.fixturePath);
  const evidenceName = `${TEST_DOC_PREFIX}${params.label}-${Date.now()}.${params.extension}`;

  const uploadFormData = new FormData();
  uploadFormData.append("file", new File([evidenceBytes], evidenceName, { type: params.mimeType }));

  const uploadResponse = await uploadRoute(
    new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body: uploadFormData
    })
  );
  expect(uploadResponse.status).toBe(201);

  const embedResponse = await embedRoute(new Request("http://localhost/api/documents/embed", { method: "POST" }));
  expect(embedResponse.status).toBe(200);

  const csvPath = join(process.cwd(), "test/fixtures/template_questionnaire.csv");
  const csvBytes = readFileSync(csvPath);

  const importFormData = new FormData();
  importFormData.append("file", new File([csvBytes], "template_questionnaire.csv", { type: "text/csv" }));
  importFormData.append("questionColumn", "Question");
  importFormData.append("name", `${TEST_Q_PREFIX}${params.label}-${Date.now()}`);

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

  const autofillResponse = await autofillRoute(new Request("http://localhost/api/questionnaires/autofill"), {
    params: {
      id: questionnaireId as string
    }
  });
  expect(autofillResponse.status).toBe(200);

  const payload = (await autofillResponse.json()) as ScenarioResult["payload"];

  const rows = await prisma.question.findMany({
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

  const rowsByQuestion = new Map(
    rows.map((row) => [
      row.text,
      {
        answer: row.answer ?? "",
        citations: Array.isArray(row.citations) ? (row.citations as Array<{ chunkId?: string }>) : []
      }
    ])
  );

  return {
    payload,
    rowsByQuestion
  };
}

function assertKeyQuestionsFoundWithCitations(result: ScenarioResult, mode: "pdf" | "txt") {
  for (const questionText of KEY_QUESTIONS) {
    const row = result.rowsByQuestion.get(questionText);
    expect(row, `${mode}: missing row for question "${questionText}"`).toBeTruthy();
    expect(row?.answer, `${mode}: expected FOUND answer for "${questionText}"`).not.toBe(NOT_FOUND_TEXT);
    expect(
      row?.citations.length ?? 0,
      `${mode}: expected citations for FOUND answer "${questionText}"`
    ).toBeGreaterThan(0);
  }

  const isoRow = result.rowsByQuestion.get(ISO_QUESTION);
  expect(isoRow, `${mode}: missing ISO question row`).toBeTruthy();
  expect(isoRow?.answer, `${mode}: ISO must stay strict NOT_FOUND`).toBe(NOT_FOUND_TEXT);
  expect(isoRow?.citations ?? [], `${mode}: ISO NOT_FOUND must have empty citations`).toEqual([]);
}

describe.sequential("pdf/txt ingestion parity regression", () => {
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
      missingPoints: ["legacy gate disabled in parity regression"],
      supportingChunkIds: []
    });

    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });
    isolatedOrgId = organization.id;
    getOrCreateDefaultOrganizationMock.mockResolvedValue(organization);

    generateEvidenceSufficiencyMock.mockImplementation(
      async (params: { question: string; snippets: Array<{ chunkId: string; quotedSnippet: string }> }) => {
        const question = params.question.toLowerCase();
        const supportingChunkIds = pickSupportingChunkIds(params.snippets);
        const context = snippetTextLower(params.snippets);

        if (question.includes("iso 27001")) {
          return toExtractorNotFound("ISO 27001 certification");
        }

        if (question.includes("mfa") || question.includes("2fa")) {
          if (!includesAll(context, ["multi-factor authentication"])) {
            return toExtractorNotFound("MFA/2FA enforcement");
          }

          return toExtractorFound({
            requirements: ["MFA/2FA enforcement"],
            values: ["MFA is required for privileged and administrative access."],
            supportingChunkIds
          });
        }

        if (question.includes("minimum tls version") || question.includes("encrypted in transit")) {
          if (!includesAll(context, ["tls 1.2"])) {
            return toExtractorNotFound("TLS minimum version");
          }

          return toExtractorFound({
            requirements: ["TLS minimum version"],
            values: ["Minimum TLS version is 1.2 (TLS 1.2+)."],
            supportingChunkIds
          });
        }

        if (question.includes("encrypted at rest for databases")) {
          if (!includesAll(context, ["aes-256", "kms"])) {
            return toExtractorNotFound("At-rest encryption with KMS");
          }

          return toExtractorFound({
            requirements: ["AES-256 at rest", "KMS-managed keys"],
            values: [
              "Databases are encrypted at rest using AES-256.",
              "Encryption keys are managed with centralized KMS."
            ],
            supportingChunkIds
          });
        }

        if (question.includes("what is your rpo")) {
          if (!includesAll(context, ["rpo", "24 hours"])) {
            return toExtractorNotFound("RPO statement");
          }

          return toExtractorFound({
            requirements: ["RPO for critical systems"],
            values: ["RPO for critical systems is 24 hours."],
            supportingChunkIds
          });
        }

        if (question.includes("what is your rto")) {
          if (!includesAll(context, ["rto", "24 hours"])) {
            return toExtractorNotFound("RTO statement");
          }

          return toExtractorFound({
            requirements: ["RTO for critical systems"],
            values: ["RTO for critical systems is 24 hours."],
            supportingChunkIds
          });
        }

        if (question.includes("soc 2") || question.includes("trust services criteria")) {
          if (!includesAll(context, ["soc 2 type ii", "trust services criteria"])) {
            return toExtractorNotFound("SOC 2 Type II and TSC coverage");
          }

          return toExtractorFound({
            requirements: ["SOC 2 Type II availability", "Trust Services Criteria coverage"],
            values: [
              "A SOC 2 Type II report is available.",
              "Covered TSC: Security, Availability, Confidentiality."
            ],
            supportingChunkIds
          });
        }

        if (supportingChunkIds.length === 0) {
          return toExtractorNotFound("Question coverage");
        }

        return toExtractorFound({
          requirements: ["Question coverage"],
          values: ["Supported by provided documents."],
          supportingChunkIds
        });
      }
    );

  });

  afterEach(async () => {
    if (!isolatedOrgId) {
      return;
    }

    await cleanupOrganizationData(isolatedOrgId);
    await prisma.organization.delete({
      where: {
        id: isolatedOrgId
      }
    });
    isolatedOrgId = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps PDF and TXT autofill outcomes aligned for the same evidence pack", async () => {
    const pdfResult = await runScenario({
      label: "pdf",
      fixturePath: join(process.cwd(), "test/fixtures/template_evidence_pack.pdf"),
      mimeType: "application/pdf",
      extension: "pdf"
    });

    if (!isolatedOrgId) {
      throw new Error("Expected isolated test organization to be initialized.");
    }
    await cleanupOrganizationData(isolatedOrgId);

    const txtResult = await runScenario({
      label: "txt",
      fixturePath: join(process.cwd(), "test/fixtures/template_evidence_pack.txt"),
      mimeType: "text/plain",
      extension: "txt"
    });

    for (const [mode, result] of [
      ["pdf", pdfResult] as const,
      ["txt", txtResult] as const
    ]) {
      expect(result.payload.totalCount, `${mode}: total count`).toBe(31);
      expect(result.payload.answeredCount, `${mode}: answered count`).toBe(31);
      expect(result.payload.foundCount, `${mode}: found count`).toBeGreaterThanOrEqual(30);
      expect(result.payload.notFoundCount, `${mode}: not found count`).toBe(1);
      assertKeyQuestionsFoundWithCitations(result, mode);
    }

    expect(pdfResult.payload.foundCount).toBe(txtResult.payload.foundCount);
    expect(pdfResult.payload.notFoundCount).toBe(txtResult.payload.notFoundCount);
  });
});
