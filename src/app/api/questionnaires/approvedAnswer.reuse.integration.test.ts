import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as uploadRoute } from "@/app/api/documents/upload/route";
import { POST as embedRoute } from "@/app/api/documents/embed/route";
import { POST as importRoute } from "@/app/api/questionnaires/import/route";
import { POST as autofillRoute } from "@/app/api/questionnaires/[id]/autofill/route";
import { POST as approvedAnswersCreateRoute } from "@/app/api/approved-answers/route";
import { GET as questionnaireDetailsRoute } from "@/app/api/questionnaires/[id]/route";
import { POST as approveReusedRoute } from "@/app/api/questionnaires/[id]/approve-reused/route";

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

const TEST_ORG_PREFIX = "vitest-approved-reuse-org-";
const TEST_DOC_PREFIX = "vitest-approved-reuse-doc-";
const TEST_Q_PREFIX = "vitest-approved-reuse-q-";
const NOT_FOUND_TEXT = "Not found in provided documents.";

const A_Q1_TLS = "What minimum TLS version is required for external traffic?";
const A_Q2_MFA = "Do you enforce MFA/2FA for privileged or administrative access?";
const A_Q3_AES = "Is data encrypted at rest using AES-256 and managed via centralized KMS?";
const A_Q4_RPO = "What is your RPO for critical systems?";
const A_Q5_SOC2 = "Do you have a SOC 2 Type II report and which Trust Services Criteria are covered?";
const A_Q6_ISO = "Are you ISO 27001 certified?";

const B_Q2_MFA_SEMANTIC = "Is MFA mandatory for administrator console access?";
const B_Q5_DR = "Do you perform disaster recovery testing? How often?";
const B_Q6_FEDRAMP = "What FedRAMP authorization level has been granted?";
const B_Q7_ISO = A_Q6_ISO;

type CitationRow = {
  chunkId?: unknown;
  docName?: unknown;
  quotedSnippet?: unknown;
};

type QuestionRow = {
  id: string;
  text: string;
  answer: string | null;
  citations: unknown;
  reviewStatus: "DRAFT" | "NEEDS_REVIEW" | "APPROVED";
  reusedFromApprovedAnswerId: string | null;
  reuseMatchType: "EXACT" | "SEMANTIC" | null;
  reusedAt: Date | null;
};

type AutofillPayload = {
  questionnaireId: string;
  totalCount: number;
  answeredCount: number;
  foundCount: number;
  notFoundCount: number;
  reusedCount: number;
  reusedFromApprovedAnswers: Array<{
    questionId: string;
    rowIndex: number;
    reusedFromApprovedAnswerId: string;
    matchType: "exact" | "near_exact" | "semantic";
  }>;
};

let isolatedOrgId: string | null = null;

function embeddingForText(input: string): number[] {
  const value = input.toLowerCase();
  const vector = new Array(1536).fill(0);
  let populated = false;

  const mark = (index: number) => {
    vector[index] = 1;
    populated = true;
  };

  if (value.includes("tls")) {
    mark(0);
  }
  if (value.includes("mfa") || value.includes("2fa") || value.includes("privileged")) {
    mark(1);
  }
  if (value.includes("aes-256") || value.includes("encrypted at rest")) {
    mark(2);
  }
  if (value.includes("kms") || value.includes("key management")) {
    mark(3);
  }
  if (value.includes("rpo")) {
    mark(4);
  }
  if (value.includes("soc 2")) {
    mark(5);
  }
  if (value.includes("trust services criteria") || value.includes("tsc")) {
    mark(6);
  }
  if (value.includes("iso 27001")) {
    mark(7);
  }
  if (value.includes("disaster recovery") || value.includes("dr tests")) {
    mark(8);
  }
  if (value.includes("fedramp")) {
    mark(9);
  }

  if (!populated) {
    mark(1200);
  }

  return vector;
}

function normalizeCitations(value: unknown): Array<{ chunkId: string; docName: string; quotedSnippet: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const typed = entry as CitationRow;
      if (typeof typed.chunkId !== "string") {
        return null;
      }

      return {
        chunkId: typed.chunkId,
        docName: typeof typed.docName === "string" ? typed.docName : "",
        quotedSnippet: typeof typed.quotedSnippet === "string" ? typed.quotedSnippet : ""
      };
    })
    .filter((entry): entry is { chunkId: string; docName: string; quotedSnippet: string } => entry !== null);
}

function pickSupportingChunkId(
  snippets: Array<{ chunkId: string; quotedSnippet: string }>,
  preferredTerms: string[]
): string[] {
  const matched = snippets.find((snippet) => {
    const snippetText = snippet.quotedSnippet.toLowerCase();
    return preferredTerms.some((term) => snippetText.includes(term));
  });

  const chunkId = matched?.chunkId ?? snippets[0]?.chunkId;
  return chunkId ? [chunkId] : [];
}

function extractorFound(params: {
  requirements: string[];
  values: string[];
  supportingChunkIds: string[];
}) {
  return {
    requirements: params.requirements,
    extracted: params.requirements.map((requirement, index) => ({
      requirement,
      value: params.values[index] ?? params.values[0] ?? "Supported by evidence.",
      supportingChunkIds: params.supportingChunkIds
    })),
    overall: "FOUND" as const,
    hadShapeRepair: false,
    extractorInvalid: false,
    invalidReason: null
  };
}

function extractorNotFound(requirement: string) {
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

async function uploadAndEmbedEvidenceTxt() {
  const fixturePath = join(process.cwd(), "test/fixtures/template_evidence_pack.txt");
  const bytes = readFileSync(fixturePath);
  const fileName = `${TEST_DOC_PREFIX}${Date.now()}.txt`;

  const uploadFormData = new FormData();
  uploadFormData.append("file", new File([bytes], fileName, { type: "text/plain" }));
  const uploadResponse = await uploadRoute(
    new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body: uploadFormData
    })
  );
  expect(uploadResponse.status).toBe(201);

  const embedResponse = await embedRoute(new Request("http://localhost/api/documents/embed", { method: "POST" }));
  expect(embedResponse.status).toBe(200);
}

async function importQuestionnaire(name: string, questions: string[]): Promise<string> {
  const csvBody = `Category,Question\n${questions.map((question) => `Control,"${question.replace(/"/g, '""')}"`).join("\n")}\n`;
  const formData = new FormData();
  formData.append("file", new File([csvBody], `${name}.csv`, { type: "text/csv" }));
  formData.append("questionColumn", "Question");
  formData.append("name", `${TEST_Q_PREFIX}${name}-${Date.now()}`);

  const importResponse = await importRoute(
    new Request("http://localhost/api/questionnaires/import", {
      method: "POST",
      body: formData
    })
  );
  expect(importResponse.status).toBe(201);
  const payload = (await importResponse.json()) as { questionnaire?: { id: string } };
  expect(payload.questionnaire?.id).toBeTruthy();

  return payload.questionnaire?.id as string;
}

async function runAutofill(questionnaireId: string): Promise<AutofillPayload> {
  const response = await autofillRoute(new Request("http://localhost/api/questionnaires/autofill"), {
    params: {
      id: questionnaireId
    }
  });
  expect(response.status).toBe(200);
  return (await response.json()) as AutofillPayload;
}

async function getQuestionRows(questionnaireId: string): Promise<QuestionRow[]> {
  return prisma.question.findMany({
    where: {
      questionnaireId
    },
    orderBy: {
      rowIndex: "asc"
    },
    select: {
      id: true,
      text: true,
      answer: true,
      citations: true,
      reviewStatus: true,
      reusedFromApprovedAnswerId: true,
      reuseMatchType: true,
      reusedAt: true
    }
  });
}

async function getQuestionnaireDetails(questionnaireId: string) {
  const response = await questionnaireDetailsRoute(new Request(`http://localhost/api/questionnaires/${questionnaireId}`), {
    params: { id: questionnaireId }
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    questions: Array<{
      id: string;
      text: string;
      reusedFromApprovedAnswerId?: string | null;
      reuseMatchType?: "EXACT" | "SEMANTIC" | null;
      reusedAt?: string | null;
      reviewStatus?: "DRAFT" | "NEEDS_REVIEW" | "APPROVED";
    }>;
  };
}

async function approveReusedExact(questionnaireId: string) {
  const response = await approveReusedRoute(
    new Request(`http://localhost/api/questionnaires/${questionnaireId}/approve-reused`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "exactOnly"
      })
    }),
    {
      params: {
        id: questionnaireId
      }
    }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    approvedCount?: number;
    skippedCount?: number;
    exactReusedCount?: number;
  };
}

async function approveQuestionsWithCitations(questionnaireId: string, questionTexts: string[]) {
  const questionRows = await getQuestionRows(questionnaireId);
  const byText = new Map(questionRows.map((row) => [row.text, row]));
  const approvedByText = new Map<
    string,
    { approvedAnswerId: string; answerText: string; citationChunkIds: string[]; questionId: string }
  >();

  for (const questionText of questionTexts) {
    const row = byText.get(questionText);
    expect(row, `Expected question row for "${questionText}"`).toBeTruthy();
    expect(row?.answer).not.toBe(NOT_FOUND_TEXT);
    const citations = normalizeCitations(row?.citations ?? []);
    expect(citations.length, `Expected citations for "${questionText}"`).toBeGreaterThan(0);

    const approveResponse = await approvedAnswersCreateRoute(
      new Request("http://localhost/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId: row?.id
        })
      })
    );
    expect(approveResponse.status).toBe(200);
    const approvePayload = (await approveResponse.json()) as {
      approvedAnswer?: { id: string };
    };
    expect(approvePayload.approvedAnswer?.id).toBeTruthy();

    const approved = await prisma.approvedAnswer.findUnique({
      where: {
        id: approvePayload.approvedAnswer?.id
      },
      select: {
        id: true,
        answerText: true,
        citationChunkIds: true,
        questionId: true
      }
    });
    expect(approved).toBeTruthy();
    approvedByText.set(questionText, {
      approvedAnswerId: approved?.id as string,
      answerText: approved?.answerText as string,
      citationChunkIds: approved?.citationChunkIds as string[],
      questionId: approved?.questionId as string
    });
  }

  return approvedByText;
}

async function assertCitationChunkOwnership(params: {
  organizationId: string;
  chunkIds: string[];
  contextLabel: string;
}) {
  if (params.chunkIds.length === 0) {
    throw new Error(`Expected non-empty citation chunk IDs for ${params.contextLabel}`);
  }

  const chunks = await prisma.documentChunk.findMany({
    where: {
      id: {
        in: params.chunkIds
      },
      document: {
        organizationId: params.organizationId
      }
    },
    select: {
      id: true
    }
  });

  expect(chunks.length, `Expected all citation chunks to exist and belong to org for ${params.contextLabel}`).toBe(
    params.chunkIds.length
  );
}

describe.sequential("approved answer reuse integration", () => {
  beforeEach(async () => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";

    createEmbeddingMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    getOrCreateDefaultOrganizationMock.mockReset();

    createEmbeddingMock.mockImplementation(async (input: string) => embeddingForText(input));
    generateGroundedAnswerMock.mockResolvedValue({
      answer: NOT_FOUND_TEXT,
      citations: [],
      confidence: "low",
      needsReview: true
    });
    generateLegacyEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: false,
      missingPoints: ["Legacy gate disabled in approved-answer reuse test"],
      supportingChunkIds: []
    });

    generateEvidenceSufficiencyMock.mockImplementation(
      async (params: { question: string; snippets: Array<{ chunkId: string; quotedSnippet: string }> }) => {
        const question = params.question.toLowerCase();

        if (question.includes("iso 27001")) {
          return extractorNotFound("ISO 27001 certification");
        }

        if (question.includes("fedramp")) {
          return extractorNotFound("FedRAMP authorization");
        }

        if (question.includes("minimum tls")) {
          return extractorFound({
            requirements: ["Minimum TLS version"],
            values: ["Minimum TLS version is 1.2 (TLS 1.2+)."],
            supportingChunkIds: pickSupportingChunkId(params.snippets, ["tls 1.2", "minimum tls"])
          });
        }

        if (question.includes("mfa") || question.includes("2fa")) {
          return extractorFound({
            requirements: ["MFA for privileged/admin access"],
            values: ["MFA is required for privileged and administrative access."],
            supportingChunkIds: pickSupportingChunkId(params.snippets, ["multi-factor authentication", "mfa"])
          });
        }

        if (question.includes("aes-256") || question.includes("encrypted at rest")) {
          return extractorFound({
            requirements: ["AES-256 at rest", "KMS-managed keys"],
            values: [
              "Data at rest uses AES-256 encryption.",
              "Keys are managed through centralized KMS."
            ],
            supportingChunkIds: pickSupportingChunkId(params.snippets, ["aes-256", "kms-managed"])
          });
        }

        if (question.includes("rpo")) {
          return extractorFound({
            requirements: ["RPO value"],
            values: ["RPO for critical systems is 24 hours."],
            supportingChunkIds: pickSupportingChunkId(params.snippets, ["rpo", "24 hours"])
          });
        }

        if (question.includes("soc 2") || question.includes("trust services criteria")) {
          return extractorFound({
            requirements: ["SOC 2 Type II report", "TSC coverage"],
            values: [
              "A SOC 2 Type II report is available.",
              "Trust Services Criteria covered: Security, Availability, Confidentiality."
            ],
            supportingChunkIds: pickSupportingChunkId(params.snippets, ["soc 2", "trust services criteria"])
          });
        }

        if (question.includes("disaster recovery testing")) {
          return extractorFound({
            requirements: ["DR testing cadence"],
            values: ["Disaster recovery testing is performed annually."],
            supportingChunkIds: pickSupportingChunkId(params.snippets, ["disaster recovery testing", "annually"])
          });
        }

        return extractorNotFound("Requested control detail");
      }
    );

    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${Date.now()}`
      }
    });
    isolatedOrgId = organization.id;
    getOrCreateDefaultOrganizationMock.mockResolvedValue(organization);
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

  it("reuses approved answers across questionnaires and blocks reuse when approved citations become invalid", async () => {
    if (!isolatedOrgId) {
      throw new Error("Expected isolated organization ID");
    }

    await uploadAndEmbedEvidenceTxt();

    const questionnaireAId = await importQuestionnaire("A", [A_Q1_TLS, A_Q2_MFA, A_Q3_AES, A_Q4_RPO, A_Q5_SOC2, A_Q6_ISO]);
    const autofillA = await runAutofill(questionnaireAId);
    expect(autofillA.totalCount).toBe(6);
    expect(autofillA.answeredCount).toBe(6);
    expect(autofillA.foundCount).toBe(5);
    expect(autofillA.notFoundCount).toBe(1);
    expect(autofillA.reusedCount).toBe(0);

    const approvedFromA = await approveQuestionsWithCitations(questionnaireAId, [
      A_Q1_TLS,
      A_Q2_MFA,
      A_Q3_AES,
      A_Q4_RPO,
      A_Q5_SOC2
    ]);
    expect(approvedFromA.size).toBe(5);

    const questionnaireAQuestions = await getQuestionRows(questionnaireAId);
    const isoA = questionnaireAQuestions.find((row) => row.text === A_Q6_ISO);
    expect(isoA?.answer).toBe(NOT_FOUND_TEXT);
    expect(normalizeCitations(isoA?.citations)).toEqual([]);

    const questionnaireBId = await importQuestionnaire("B", [
      A_Q1_TLS,
      B_Q2_MFA_SEMANTIC,
      A_Q3_AES,
      A_Q4_RPO,
      B_Q5_DR,
      B_Q6_FEDRAMP,
      B_Q7_ISO
    ]);
    const autofillB = await runAutofill(questionnaireBId);

    expect(autofillB.totalCount).toBe(7);
    expect(autofillB.answeredCount).toBe(7);
    expect(autofillB.reusedCount).toBe(4);

    const bRows = await getQuestionRows(questionnaireBId);
    const bByText = new Map(bRows.map((row) => [row.text, row]));
    const reusedByQuestionId = new Map(
      autofillB.reusedFromApprovedAnswers.map((entry) => [entry.questionId, entry.reusedFromApprovedAnswerId])
    );

    const exactOverlaps = [A_Q1_TLS, A_Q3_AES, A_Q4_RPO];
    for (const overlappingQuestionText of exactOverlaps) {
      const row = bByText.get(overlappingQuestionText);
      const approved = approvedFromA.get(overlappingQuestionText);
      expect(row, `Missing B row for overlap question "${overlappingQuestionText}"`).toBeTruthy();
      expect(approved, `Missing approved answer from A for "${overlappingQuestionText}"`).toBeTruthy();

      const reusedApprovedId = reusedByQuestionId.get(row?.id as string);
      expect(reusedApprovedId).toBeTruthy();
      expect(reusedApprovedId).toBe(approved?.approvedAnswerId);

      expect(row?.answer).toBe(approved?.answerText);
      expect(row?.reusedFromApprovedAnswerId).toBe(approved?.approvedAnswerId);
      expect(row?.reuseMatchType).toBe("EXACT");
      expect(row?.reusedAt).toBeTruthy();
      expect(row?.reviewStatus).not.toBe("APPROVED");

      const citationChunkIds = normalizeCitations(row?.citations).map((citation) => citation.chunkId);
      expect(citationChunkIds.length).toBeGreaterThan(0);
      expect(citationChunkIds).toEqual(approved?.citationChunkIds);
      await assertCitationChunkOwnership({
        organizationId: isolatedOrgId,
        chunkIds: citationChunkIds,
        contextLabel: overlappingQuestionText
      });
    }

    const semanticRow = bByText.get(B_Q2_MFA_SEMANTIC);
    const approvedMfa = approvedFromA.get(A_Q2_MFA);
    expect(semanticRow, `Missing B row for semantic overlap question "${B_Q2_MFA_SEMANTIC}"`).toBeTruthy();
    expect(approvedMfa, `Missing approved answer from A for "${A_Q2_MFA}"`).toBeTruthy();

    const semanticReusedApprovedId = reusedByQuestionId.get(semanticRow?.id as string);
    expect(semanticReusedApprovedId).toBeTruthy();
    expect(semanticReusedApprovedId).toBe(approvedMfa?.approvedAnswerId);
    expect(semanticRow?.answer).toBe(approvedMfa?.answerText);
    expect(semanticRow?.reusedFromApprovedAnswerId).toBe(approvedMfa?.approvedAnswerId);
    expect(semanticRow?.reuseMatchType).toBe("SEMANTIC");
    expect(semanticRow?.reusedAt).toBeTruthy();
    expect(semanticRow?.reviewStatus).not.toBe("APPROVED");

    const semanticCitationChunkIds = normalizeCitations(semanticRow?.citations).map((citation) => citation.chunkId);
    expect(semanticCitationChunkIds.length).toBeGreaterThan(0);
    expect(semanticCitationChunkIds).toEqual(approvedMfa?.citationChunkIds);
    await assertCitationChunkOwnership({
      organizationId: isolatedOrgId,
      chunkIds: semanticCitationChunkIds,
      contextLabel: B_Q2_MFA_SEMANTIC
    });

    const detailsBeforeBulkApprove = await getQuestionnaireDetails(questionnaireBId);
    const detailsBeforeBulkApproveById = new Map(detailsBeforeBulkApprove.questions.map((row) => [row.id, row]));
    for (const questionText of exactOverlaps) {
      const row = bByText.get(questionText);
      const detail = detailsBeforeBulkApproveById.get(row?.id as string);
      expect(detail?.reusedFromApprovedAnswerId).toBeTruthy();
      expect(detail?.reuseMatchType).toBe("EXACT");
      expect(detail?.reusedAt).toBeTruthy();
    }
    const semanticDetail = detailsBeforeBulkApproveById.get(semanticRow?.id as string);
    expect(semanticDetail?.reusedFromApprovedAnswerId).toBeTruthy();
    expect(semanticDetail?.reuseMatchType).toBe("SEMANTIC");
    expect(semanticDetail?.reusedAt).toBeTruthy();

    for (const nonOverlappingQuestionText of [B_Q5_DR, B_Q6_FEDRAMP]) {
      const row = bByText.get(nonOverlappingQuestionText);
      expect(row, `Missing B row for non-overlap question "${nonOverlappingQuestionText}"`).toBeTruthy();
      expect(reusedByQuestionId.has(row?.id as string)).toBe(false);

      if (row?.answer === NOT_FOUND_TEXT) {
        expect(normalizeCitations(row?.citations)).toEqual([]);
      } else {
        const citationChunkIds = normalizeCitations(row?.citations).map((citation) => citation.chunkId);
        expect(citationChunkIds.length).toBeGreaterThan(0);
        await assertCitationChunkOwnership({
          organizationId: isolatedOrgId,
          chunkIds: citationChunkIds,
          contextLabel: nonOverlappingQuestionText
        });
      }
    }

    const isoB = bByText.get(B_Q7_ISO);
    expect(isoB).toBeTruthy();
    expect(reusedByQuestionId.has(isoB?.id as string)).toBe(false);
    expect(isoB?.answer).toBe(NOT_FOUND_TEXT);
    expect(normalizeCitations(isoB?.citations)).toEqual([]);

    const approveReusedExactResult = await approveReusedExact(questionnaireBId);
    expect(approveReusedExactResult.exactReusedCount).toBe(3);
    expect(approveReusedExactResult.approvedCount).toBe(3);

    const bRowsAfterBulkApprove = await getQuestionRows(questionnaireBId);
    const bAfterBulkApproveByText = new Map(bRowsAfterBulkApprove.map((row) => [row.text, row]));
    for (const exactQuestionText of exactOverlaps) {
      expect(bAfterBulkApproveByText.get(exactQuestionText)?.reviewStatus).toBe("APPROVED");
    }
    expect(bAfterBulkApproveByText.get(B_Q2_MFA_SEMANTIC)?.reviewStatus).not.toBe("APPROVED");
    expect(bAfterBulkApproveByText.get(B_Q7_ISO)?.answer).toBe(NOT_FOUND_TEXT);
    expect(bAfterBulkApproveByText.get(B_Q7_ISO)?.reviewStatus).not.toBe("APPROVED");

    const deletedChunkId = approvedFromA.get(A_Q1_TLS)?.citationChunkIds[0];
    expect(deletedChunkId).toBeTruthy();

    await prisma.documentChunk.delete({
      where: {
        id: deletedChunkId as string
      }
    });

    const invalidatedApprovedAnswers = await prisma.approvedAnswer.findMany({
      where: {
        organizationId: isolatedOrgId,
        citationChunkIds: {
          has: deletedChunkId as string
        }
      },
      select: {
        id: true,
        question: {
          select: {
            text: true
          }
        }
      }
    });
    const invalidatedQuestionTexts = new Set(invalidatedApprovedAnswers.map((row) => row.question.text));
    expect(invalidatedQuestionTexts.size).toBeGreaterThan(0);

    const autofillBAfterDelete = await runAutofill(questionnaireBId);
    const reusedAfterDeleteByQuestionId = new Map(
      autofillBAfterDelete.reusedFromApprovedAnswers.map((entry) => [entry.questionId, entry.reusedFromApprovedAnswerId])
    );
    const bRowsAfterDelete = await getQuestionRows(questionnaireBId);
    const bAfterDeleteByText = new Map(bRowsAfterDelete.map((row) => [row.text, row]));

    for (const invalidatedText of invalidatedQuestionTexts) {
      const row = bAfterDeleteByText.get(invalidatedText);
      if (!row) {
        continue;
      }

      expect(reusedAfterDeleteByQuestionId.has(row.id), `Expected no reuse for invalidated question "${invalidatedText}"`).toBe(
        false
      );

      if (row.answer === NOT_FOUND_TEXT) {
        expect(normalizeCitations(row.citations)).toEqual([]);
      } else {
        const chunkIds = normalizeCitations(row.citations).map((citation) => citation.chunkId);
        expect(chunkIds.length).toBeGreaterThan(0);
        await assertCitationChunkOwnership({
          organizationId: isolatedOrgId,
          chunkIds,
          contextLabel: `invalidated:${invalidatedText}`
        });
      }
    }

    for (const row of bRowsAfterDelete) {
      const chunkIds = normalizeCitations(row.citations).map((citation) => citation.chunkId);
      if (chunkIds.length === 0) {
        continue;
      }

      await assertCitationChunkOwnership({
        organizationId: isolatedOrgId,
        chunkIds,
        contextLabel: `post-delete:${row.text}`
      });
    }
  });
});
