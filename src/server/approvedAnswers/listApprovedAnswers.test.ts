import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncApprovedAnswerEvidenceSnapshots } from "@/server/approvedAnswers/evidenceSnapshots";
import { computeEvidenceFingerprint } from "@/server/evidenceFingerprint";
import { listApprovedAnswersForOrg } from "@/server/approvedAnswers/listApprovedAnswers";

const TEST_ORG_PREFIX = "vitest-approved-answers-library-";

async function cleanupTestOrganizations() {
  const organizations = await prisma.organization.findMany({
    where: {
      name: {
        startsWith: TEST_ORG_PREFIX
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
  const questionnaires = await prisma.questionnaire.findMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    },
    select: {
      id: true
    }
  });
  const questionnaireIds = questionnaires.map((questionnaire) => questionnaire.id);
  const questions = await prisma.question.findMany({
    where: {
      questionnaireId: {
        in: questionnaireIds
      }
    },
    select: {
      id: true
    }
  });
  const questionIds = questions.map((question) => question.id);
  const approvedAnswers = await prisma.approvedAnswer.findMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    },
    select: {
      id: true
    }
  });
  const approvedAnswerIds = approvedAnswers.map((approvedAnswer) => approvedAnswer.id);

  await prisma.approvedAnswerEvidence.deleteMany({
    where: {
      approvedAnswerId: {
        in: approvedAnswerIds
      }
    }
  });

  await prisma.approvedAnswer.deleteMany({
    where: {
      id: {
        in: approvedAnswerIds
      }
    }
  });

  await prisma.questionHistoryEvent.deleteMany({
    where: {
      questionId: {
        in: questionIds
      }
    }
  });

  await prisma.question.deleteMany({
    where: {
      id: {
        in: questionIds
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

  await prisma.membership.deleteMany({
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

async function createOrganization(nameSuffix: string) {
  return prisma.organization.create({
    data: {
      name: `${TEST_ORG_PREFIX}${nameSuffix}-${randomUUID()}`
    }
  });
}

async function createQuestionnaire(organizationId: string, name: string) {
  return prisma.questionnaire.create({
    data: {
      organizationId,
      name,
      totalCount: 1
    }
  });
}

async function seedApprovedAnswer(params: {
  organizationId: string;
  questionnaireId: string;
  rowIndex: number;
  questionText: string;
  answerText: string;
  chunkText: string;
  draftSuggestionApplied?: boolean;
  reusedFromApprovedAnswerId?: string | null;
  createdAt?: Date;
}) {
  const document = await prisma.document.create({
    data: {
      organizationId: params.organizationId,
      name: `approved-answer-doc-${randomUUID()}`,
      originalName: `approved-answer-doc-${randomUUID()}.txt`,
      mimeType: "text/plain",
      status: "CHUNKED"
    }
  });

  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      content: params.chunkText,
      evidenceFingerprint: computeEvidenceFingerprint(params.chunkText)
    }
  });

  const question = await prisma.question.create({
    data: {
      questionnaireId: params.questionnaireId,
      rowIndex: params.rowIndex,
      sourceRow: {
        Question: params.questionText
      },
      text: params.questionText,
      answer: params.answerText,
      citations: [
        {
          chunkId: chunk.id,
          docName: document.name,
          quotedSnippet: params.chunkText
        }
      ],
      reviewStatus: "APPROVED",
      draftSuggestionApplied: params.draftSuggestionApplied ?? false,
      reusedFromApprovedAnswerId: params.reusedFromApprovedAnswerId ?? null
    }
  });

  const approvedAnswer = await prisma.approvedAnswer.create({
    data: {
      organizationId: params.organizationId,
      questionId: question.id,
      normalizedQuestionText: params.questionText.toLowerCase(),
      questionTextHash: `hash-${randomUUID()}`,
      answerText: params.answerText,
      citationChunkIds: [chunk.id],
      source: "GENERATED",
      ...(params.createdAt
        ? {
            createdAt: params.createdAt,
            updatedAt: params.createdAt
          }
        : {})
    }
  });

  await syncApprovedAnswerEvidenceSnapshots({
    db: prisma,
    organizationId: params.organizationId,
    approvedAnswerId: approvedAnswer.id,
    citationChunkIds: [chunk.id]
  });

  return {
    approvedAnswerId: approvedAnswer.id,
    questionId: question.id,
    questionnaireId: params.questionnaireId,
    chunkId: chunk.id
  };
}

describe.sequential("listApprovedAnswersForOrg", () => {
  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  it("scopes approved answers to the active organization", async () => {
    const orgA = await createOrganization("scope-a");
    const orgB = await createOrganization("scope-b");
    const questionnaireA = await createQuestionnaire(orgA.id, "Org A Questionnaire");
    const questionnaireB = await createQuestionnaire(orgB.id, "Org B Questionnaire");

    const visible = await seedApprovedAnswer({
      organizationId: orgA.id,
      questionnaireId: questionnaireA.id,
      rowIndex: 0,
      questionText: "How do you encrypt backups?",
      answerText: "Backups are encrypted using AES-256.",
      chunkText: "Backups are encrypted using AES-256."
    });

    await seedApprovedAnswer({
      organizationId: orgB.id,
      questionnaireId: questionnaireB.id,
      rowIndex: 0,
      questionText: "How do you encrypt backups?",
      answerText: "This row should not leak across orgs.",
      chunkText: "This row should not leak across orgs."
    });

    const result = await listApprovedAnswersForOrg({
      orgId: orgA.id
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.approvedAnswerId).toBe(visible.approvedAnswerId);
    expect(result.counts).toEqual({
      total: 1,
      fresh: 1,
      stale: 0
    });
  });

  it("filters approved answers by freshness", async () => {
    const organization = await createOrganization("freshness");
    const questionnaire = await createQuestionnaire(organization.id, "Freshness Questionnaire");

    const fresh = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "What encryption is used in transit?",
      answerText: "Traffic is protected with TLS 1.2 or higher.",
      chunkText: "Traffic is protected with TLS 1.2 or higher."
    });

    const stale = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "How is data encrypted at rest?",
      answerText: "Data at rest is encrypted with AES-256.",
      chunkText: "Data at rest is encrypted with AES-256."
    });

    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: "Data at rest is encrypted with AES-256-GCM.",
        evidenceFingerprint: computeEvidenceFingerprint("Data at rest is encrypted with AES-256-GCM.")
      }
    });

    const freshOnly = await listApprovedAnswersForOrg(
      {
        orgId: organization.id
      },
      {
        freshness: "FRESH"
      }
    );

    expect(freshOnly.rows.map((row) => row.approvedAnswerId)).toEqual([fresh.approvedAnswerId]);
    expect(freshOnly.counts).toEqual({
      total: 1,
      fresh: 1,
      stale: 0
    });

    const staleOnly = await listApprovedAnswersForOrg(
      {
        orgId: organization.id
      },
      {
        freshness: "STALE"
      }
    );

    expect(staleOnly.rows.map((row) => row.approvedAnswerId)).toEqual([stale.approvedAnswerId]);
    expect(staleOnly.counts).toEqual({
      total: 1,
      fresh: 0,
      stale: 1
    });
  });

  it("filters approved answers by search query", async () => {
    const organization = await createOrganization("search");
    const questionnaire = await createQuestionnaire(organization.id, "Search Questionnaire");

    const matching = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you enforce SSO?",
      answerText: "SSO is enforced for production applications.",
      chunkText: "SSO is enforced for production applications."
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "Do you support hardware tokens?",
      answerText: "Hardware tokens are available for privileged accounts.",
      chunkText: "Hardware tokens are available for privileged accounts."
    });

    const result = await listApprovedAnswersForOrg(
      {
        orgId: organization.id
      },
      {
        query: "production applications"
      }
    );

    expect(result.rows.map((row) => row.approvedAnswerId)).toEqual([matching.approvedAnswerId]);
    expect(result.counts).toEqual({
      total: 1,
      fresh: 1,
      stale: 0
    });
  });

  it("derives snapshot, reuse, and suggestion-assisted metadata", async () => {
    const organization = await createOrganization("metadata");
    const questionnaire = await createQuestionnaire(organization.id, "Metadata Questionnaire");

    const source = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Describe your access reviews.",
      answerText: "Access reviews occur quarterly.",
      chunkText: "Access reviews occur quarterly."
    });

    const reused = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "How often are entitlements reviewed?",
      answerText: "Access reviews occur quarterly for all privileged accounts.",
      chunkText: "Access reviews occur quarterly for all privileged accounts.",
      draftSuggestionApplied: true,
      reusedFromApprovedAnswerId: source.approvedAnswerId
    });

    const result = await listApprovedAnswersForOrg({
      orgId: organization.id
    });

    const reusedRow = result.rows.find((row) => row.approvedAnswerId === reused.approvedAnswerId);
    expect(reusedRow).toMatchObject({
      snapshottedCitationsCount: 1,
      reused: true,
      suggestionAssisted: true,
      sourceQuestionnaireId: questionnaire.id,
      sourceItemId: reused.questionId,
      freshness: "FRESH"
    });
  });

  it("returns accurate counts for the current filtered dataset", async () => {
    const organization = await createOrganization("counts");
    const questionnaire = await createQuestionnaire(organization.id, "Counts Questionnaire");

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      questionText: "Do you support SSO?",
      answerText: "SSO is enforced for workforce users.",
      chunkText: "SSO is enforced for workforce users."
    });

    await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 1,
      questionText: "How do you log admin actions?",
      answerText: "Admin actions are logged centrally.",
      chunkText: "Admin actions are logged centrally."
    });

    const stale = await seedApprovedAnswer({
      organizationId: organization.id,
      questionnaireId: questionnaire.id,
      rowIndex: 2,
      questionText: "Do you encrypt customer data?",
      answerText: "Customer data is encrypted at rest.",
      chunkText: "Customer data is encrypted at rest."
    });

    await prisma.documentChunk.update({
      where: {
        id: stale.chunkId
      },
      data: {
        content: "Customer data is encrypted at rest and in transit.",
        evidenceFingerprint: computeEvidenceFingerprint("Customer data is encrypted at rest and in transit.")
      }
    });

    const result = await listApprovedAnswersForOrg({
      orgId: organization.id
    });

    expect(result.counts).toEqual({
      total: 3,
      fresh: 2,
      stale: 1
    });
  });
});
