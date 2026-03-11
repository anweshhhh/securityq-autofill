import { prisma } from "@/lib/prisma";
import { getApprovedAnswerStalenessDetails } from "@/server/approvedAnswers/staleness";

export type ApprovedAnswerLibraryDetail = {
  approvedAnswerId: string;
  answerText: string;
  approvedAt: string;
  freshness: "FRESH" | "STALE";
  snapshottedCitationsCount: number;
  reused: boolean;
  suggestionAssisted: boolean;
  staleReasonSummary: null | {
    affectedCitationsCount: number;
    changedCount: number;
    missingCount: number;
  };
  sourceQuestionnaireId: string | null;
  sourceItemId: string | null;
};

export async function getApprovedAnswerLibraryDetail(
  ctx: {
    orgId: string;
  },
  approvedAnswerId: string
): Promise<ApprovedAnswerLibraryDetail | null> {
  const approvedAnswer = await prisma.approvedAnswer.findFirst({
    where: {
      id: approvedAnswerId,
      organizationId: ctx.orgId
    },
    select: {
      id: true,
      answerText: true,
      createdAt: true,
      question: {
        select: {
          id: true,
          questionnaireId: true,
          draftSuggestionApplied: true,
          reusedFromApprovedAnswerId: true
        }
      }
    }
  });

  if (!approvedAnswer) {
    return null;
  }

  const [staleness, snapshottedCitationsCount] = await Promise.all([
    getApprovedAnswerStalenessDetails(approvedAnswer.id, ctx),
    prisma.approvedAnswerEvidence.count({
      where: {
        approvedAnswerId: approvedAnswer.id
      }
    })
  ]);

  return {
    approvedAnswerId: approvedAnswer.id,
    answerText: approvedAnswer.answerText,
    approvedAt: approvedAnswer.createdAt.toISOString(),
    freshness: staleness.isStale ? "STALE" : "FRESH",
    snapshottedCitationsCount,
    reused: Boolean(approvedAnswer.question.reusedFromApprovedAnswerId),
    suggestionAssisted: approvedAnswer.question.draftSuggestionApplied,
    staleReasonSummary: staleness.details
      ? {
          affectedCitationsCount: staleness.details.affectedCitationsCount,
          changedCount: staleness.details.changedCount,
          missingCount: staleness.details.missingCount
        }
      : null,
    sourceQuestionnaireId: approvedAnswer.question.questionnaireId,
    sourceItemId: approvedAnswer.question.id
  };
}
