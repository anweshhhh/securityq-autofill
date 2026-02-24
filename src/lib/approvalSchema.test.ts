import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

type SeededQuestion = {
  organizationId: string;
  questionnaireId: string;
  questionId: string;
};

const TEST_ORG_PREFIX = "vitest-phase1-approval-";

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

  await prisma.organization.deleteMany({
    where: {
      id: {
        in: organizationIds
      }
    }
  });
}

async function seedQuestion(): Promise<SeededQuestion> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: {
      name: `${TEST_ORG_PREFIX}${suffix}`
    }
  });

  const questionnaire = await prisma.questionnaire.create({
    data: {
      organizationId: organization.id,
      name: `q-${suffix}`,
      totalCount: 1
    }
  });

  const question = await prisma.question.create({
    data: {
      questionnaireId: questionnaire.id,
      rowIndex: 0,
      sourceRow: { prompt: "generic prompt" },
      text: "generic question",
      citations: []
    }
  });

  return {
    organizationId: organization.id,
    questionnaireId: questionnaire.id,
    questionId: question.id
  };
}

describe.sequential("phase1 approval schema", () => {
  afterEach(async () => {
    await cleanupTestOrganizations();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates Question with default reviewStatus=DRAFT", async () => {
    const seeded = await seedQuestion();

    const question = await prisma.question.findUniqueOrThrow({
      where: {
        id: seeded.questionId
      },
      select: {
        reviewStatus: true
      }
    });

    expect(question.reviewStatus).toBe("DRAFT");
  });

  it("upserts ApprovedAnswer and enforces unique questionId", async () => {
    const seeded = await seedQuestion();

    const first = await prisma.approvedAnswer.upsert({
      where: {
        questionId: seeded.questionId
      },
      create: {
        organizationId: seeded.organizationId,
        questionId: seeded.questionId,
        answerText: "baseline approved answer",
        citationChunkIds: ["chunk-1"],
        source: "GENERATED"
      },
      update: {
        answerText: "updated approved answer",
        citationChunkIds: ["chunk-1", "chunk-2"],
        source: "MANUAL_EDIT",
        approvedBy: "reviewer"
      }
    });

    const second = await prisma.approvedAnswer.upsert({
      where: {
        questionId: seeded.questionId
      },
      create: {
        organizationId: seeded.organizationId,
        questionId: seeded.questionId,
        answerText: "should not create second row",
        citationChunkIds: ["chunk-3"],
        source: "MANUAL_EDIT"
      },
      update: {
        answerText: "updated approved answer v2",
        citationChunkIds: ["chunk-2"],
        source: "MANUAL_EDIT",
        note: "edited"
      }
    });

    expect(first.id).toBe(second.id);

    const count = await prisma.approvedAnswer.count({
      where: {
        questionId: seeded.questionId
      }
    });

    expect(count).toBe(1);

    await expect(
      prisma.approvedAnswer.create({
        data: {
          organizationId: seeded.organizationId,
          questionId: seeded.questionId,
          answerText: "duplicate",
          citationChunkIds: ["chunk-9"],
          source: "GENERATED"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
