import { prisma } from "@/lib/prisma";
import { findStaleApprovedItemsForQuestionnaire, type StaleQuestionnaireItem } from "@/server/approvedAnswers/staleness";

export type QuestionnaireStaleItem = {
  questionnaireItemId: string;
  rowIndex: number | null;
};

export type QuestionnaireStalenessSummary = {
  staleCount: number;
  staleItems: QuestionnaireStaleItem[];
};

type StalenessRequestContext = {
  orgId: string;
};

export async function getQuestionnaireStaleness(
  ctx: StalenessRequestContext,
  questionnaireId: string
): Promise<QuestionnaireStalenessSummary> {
  const staleItems = await findStaleApprovedItemsForQuestionnaire({
    questionnaireId,
    orgId: ctx.orgId
  });

  const normalizedItems: QuestionnaireStaleItem[] = staleItems.map((item: StaleQuestionnaireItem) => ({
    questionnaireItemId: item.questionnaireItemId,
    rowIndex: item.rowIndex
  }));

  return {
    staleCount: normalizedItems.length,
    staleItems: normalizedItems
  };
}

export async function ensureQuestionnaireForOrg(params: {
  questionnaireId: string;
  orgId: string;
}): Promise<boolean> {
  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: params.questionnaireId,
      organizationId: params.orgId
    },
    select: {
      id: true
    }
  });

  return Boolean(questionnaire);
}

