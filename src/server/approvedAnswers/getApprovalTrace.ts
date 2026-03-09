import { prisma } from "@/lib/prisma";
import { isApprovedAnswerStale } from "@/server/approvedAnswers/staleness";

export type ApprovalTraceResult = {
  hasApprovedAnswer: boolean;
  trace: null | {
    approvedAt: string;
    freshness: "FRESH" | "STALE";
    snapshottedCitationsCount: number;
    reusedFromApprovedAnswer: boolean;
    suggestionAssisted: boolean;
  };
};

export async function getApprovalTraceForItem(
  ctx: {
    orgId: string;
  },
  questionnaireId: string,
  itemId: string
): Promise<ApprovalTraceResult | null> {
  const question = await prisma.question.findFirst({
    where: {
      id: itemId,
      questionnaireId,
      questionnaire: {
        organizationId: ctx.orgId
      }
    },
    select: {
      reusedFromApprovedAnswerId: true,
      draftSuggestionApplied: true,
      approvedAnswer: {
        select: {
          id: true,
          createdAt: true
        }
      }
    }
  });

  if (!question) {
    return null;
  }

  if (!question.approvedAnswer) {
    return {
      hasApprovedAnswer: false,
      trace: null
    };
  }

  const [isStale, snapshottedCitationsCount] = await Promise.all([
    isApprovedAnswerStale(question.approvedAnswer.id, {
      orgId: ctx.orgId
    }),
    prisma.approvedAnswerEvidence.count({
      where: {
        approvedAnswerId: question.approvedAnswer.id
      }
    })
  ]);

  return {
    hasApprovedAnswer: true,
    trace: {
      approvedAt: question.approvedAnswer.createdAt.toISOString(),
      freshness: isStale ? "STALE" : "FRESH",
      snapshottedCitationsCount,
      reusedFromApprovedAnswer: Boolean(question.reusedFromApprovedAnswerId),
      suggestionAssisted: question.draftSuggestionApplied
    }
  };
}
