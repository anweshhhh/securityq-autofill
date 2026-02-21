import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";
import { POST as importRoute } from "./route";

const TEST_QUESTIONNAIRE_NAME_PREFIX = "vitest-import-";

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

describe.sequential("questionnaire import route", () => {
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

  it("imports csv rows with preserved order, row json, and selected question column", async () => {
    const csvContent =
      "\uFEFFControl ID,Question,Question,Notes\n" +
      'ENC-1,"Is TLS enabled?","Duplicate question col","Line 1\nLine 2"\n' +
      'ENC-2,"Are backups encrypted?","Another duplicate","Includes KMS, AES-256"\n';

    const formData = new FormData();
    formData.append("file", new File([csvContent], "questionnaire.csv", { type: "text/csv" }));
    formData.append("questionColumn", "Question");
    formData.append("name", `${TEST_QUESTIONNAIRE_NAME_PREFIX}${Date.now()}`);

    const response = await importRoute(
      new Request("http://localhost/api/questionnaires/import", {
        method: "POST",
        body: formData
      })
    );

    const payload = await response.json();

    expect(response.status).toBe(201);
    const questionnaireId = payload.questionnaire.id as string;

    const questionnaire = await prisma.questionnaire.findUnique({
      where: { id: questionnaireId }
    });

    expect(questionnaire).not.toBeNull();
    expect(questionnaire?.questionColumn).toBe("Question");
    expect(questionnaire?.sourceHeaders).toEqual(["Control ID", "Question", "Question (2)", "Notes"]);

    const questions = await prisma.question.findMany({
      where: { questionnaireId },
      orderBy: { rowIndex: "asc" }
    });

    expect(questions).toHaveLength(2);
    expect(questions[0].rowIndex).toBe(0);
    expect(questions[1].rowIndex).toBe(1);
    expect(questions[0].text).toBe("Is TLS enabled?");

    const firstSourceRow = questions[0].sourceRow as Record<string, string>;
    expect(firstSourceRow["Question"]).toBe("Is TLS enabled?");
    expect(firstSourceRow["Question (2)"]).toBe("Duplicate question col");
    expect(firstSourceRow["Notes"]).toBe("Line 1\nLine 2");
  });
});
