import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";
import { GET as listQuestionnaires } from "../../route";
import { POST as archiveQuestionnaire } from "./route";

const TEST_QUESTIONNAIRE_NAME_PREFIX = "vitest-archive-";

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

describe.sequential("questionnaire archive route", () => {
  beforeEach(async () => {
    await cleanupQuestionnaires();
    await getOrCreateDefaultOrganization();
  });

  afterEach(async () => {
    await cleanupQuestionnaires();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("archives questionnaire and hides it from the list endpoint", async () => {
    const organization = await getOrCreateDefaultOrganization();
    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: `${TEST_QUESTIONNAIRE_NAME_PREFIX}${Date.now()}`,
        questionColumn: "Question",
        sourceHeaders: ["Question"],
        totalCount: 1
      }
    });

    await prisma.question.create({
      data: {
        questionnaireId: questionnaire.id,
        rowIndex: 0,
        text: "Question A",
        sourceRow: { Question: "Question A" },
        citations: []
      }
    });

    const archiveResponse = await archiveQuestionnaire(new Request("http://localhost"), {
      params: { id: questionnaire.id }
    });
    const archivePayload = (await archiveResponse.json()) as { ok?: boolean };

    expect(archiveResponse.status).toBe(200);
    expect(archivePayload.ok).toBe(true);

    const archivedRecord = await prisma.questionnaire.findUnique({
      where: { id: questionnaire.id }
    });
    expect(archivedRecord?.archivedAt).not.toBeNull();

    const listResponse = await listQuestionnaires();
    const listPayload = (await listResponse.json()) as {
      questionnaires: Array<{ id: string }>;
    };

    const found = listPayload.questionnaires.find((item) => item.id === questionnaire.id);
    expect(found).toBeUndefined();
  });
});
