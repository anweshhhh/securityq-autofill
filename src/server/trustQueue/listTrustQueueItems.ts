import { prisma } from "@/lib/prisma";
import { findStaleApprovedAnswerIds } from "@/server/approvedAnswers/staleness";

export type TrustQueueFilter = "ALL" | "STALE" | "NEEDS_REVIEW";

export type TrustQueueRow = {
  questionnaireId: string;
  questionnaireName: string;
  itemId: string;
  questionPreview: string;
  reviewStatus: "NEEDS_REVIEW" | "APPROVED" | "OTHER";
  freshness: "FRESH" | "STALE" | null;
  approvedAt: string | null;
  isBlockedForApprovedOnlyExport: boolean;
};

export type TrustQueueResult = {
  rows: TrustQueueRow[];
  summary: {
    staleApprovalsCount: number;
    needsReviewCount: number;
    blockedQuestionnairesCount: number;
  };
};

function normalizeQuery(value?: string | null): string {
  return (value ?? "").trim();
}

function normalizeFilter(value?: string | null): TrustQueueFilter {
  if (value === "STALE" || value === "NEEDS_REVIEW" || value === "ALL") {
    return value;
  }

  return "ALL";
}

function buildQuestionPreview(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 200) {
    return normalized;
  }

  return `${normalized.slice(0, 197).trimEnd()}...`;
}

function normalizeReviewStatus(value: string): TrustQueueRow["reviewStatus"] {
  if (value === "APPROVED") {
    return "APPROVED";
  }

  if (value === "NEEDS_REVIEW") {
    return "NEEDS_REVIEW";
  }

  return "OTHER";
}

export async function listTrustQueueItemsForOrg(
  ctx: {
    orgId: string;
  },
  params?: {
    query?: string | null;
    filter?: TrustQueueFilter | string | null;
    limit?: number;
  }
): Promise<TrustQueueResult> {
  const query = normalizeQuery(params?.query);
  const filter = normalizeFilter(params?.filter);
  const limit = Math.max(1, Math.min(params?.limit ?? 100, 100));

  const questions = await prisma.question.findMany({
    where: {
      questionnaire: {
        organizationId: ctx.orgId,
        ...(query
          ? {
              name: {
                contains: query,
                mode: "insensitive"
              }
            }
          : {})
      },
      OR: [
        {
          reviewStatus: "NEEDS_REVIEW"
        },
        {
          approvedAnswer: {
            isNot: null
          }
        }
      ]
    },
    select: {
      id: true,
      text: true,
      rowIndex: true,
      reviewStatus: true,
      updatedAt: true,
      questionnaireId: true,
      questionnaire: {
        select: {
          name: true
        }
      },
      approvedAnswer: {
        select: {
          id: true,
          createdAt: true,
          citationChunkIds: true
        }
      }
    }
  });

  if (questions.length === 0) {
    return {
      rows: [],
      summary: {
        staleApprovalsCount: 0,
        needsReviewCount: 0,
        blockedQuestionnairesCount: 0
      }
    };
  }

  const staleApprovedAnswerIds = await findStaleApprovedAnswerIds({
    orgId: ctx.orgId,
    approvedAnswers: questions.flatMap((question) =>
      question.approvedAnswer
        ? [
            {
              approvedAnswerId: question.approvedAnswer.id,
              citationChunkIds: question.approvedAnswer.citationChunkIds
            }
          ]
        : []
    )
  });

  const actionableRows = questions
    .map((question) => {
      const approvedAnswer = question.approvedAnswer;
      const isStale = approvedAnswer ? staleApprovedAnswerIds.has(approvedAnswer.id) : false;
      const isNeedsReview = question.reviewStatus === "NEEDS_REVIEW";

      if (!isStale && !isNeedsReview) {
        return null;
      }

      return {
        questionnaireId: question.questionnaireId,
        questionnaireName: question.questionnaire.name,
        itemId: question.id,
        questionPreview: buildQuestionPreview(question.text),
        reviewStatus: normalizeReviewStatus(question.reviewStatus),
        freshness: approvedAnswer ? (isStale ? "STALE" : "FRESH") : null,
        approvedAt: approvedAnswer ? approvedAnswer.createdAt.toISOString() : null,
        isBlockedForApprovedOnlyExport: isStale,
        rowIndex: question.rowIndex,
        sortTimestamp: (approvedAnswer?.createdAt ?? question.updatedAt).getTime()
      };
    })
    .filter(
      (
        row
      ): row is TrustQueueRow & {
        rowIndex: number;
        sortTimestamp: number;
      } => row !== null
    );

  const sortedRows = actionableRows.sort((left, right) => {
    const leftPriority = left.freshness === "STALE" ? 0 : left.reviewStatus === "NEEDS_REVIEW" ? 1 : 2;
    const rightPriority = right.freshness === "STALE" ? 0 : right.reviewStatus === "NEEDS_REVIEW" ? 1 : 2;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (left.sortTimestamp !== right.sortTimestamp) {
      return right.sortTimestamp - left.sortTimestamp;
    }

    if (left.questionnaireName !== right.questionnaireName) {
      return left.questionnaireName.localeCompare(right.questionnaireName);
    }

    return left.rowIndex - right.rowIndex;
  });

  const rows =
    filter === "STALE"
      ? sortedRows.filter((row) => row.freshness === "STALE")
      : filter === "NEEDS_REVIEW"
        ? sortedRows.filter((row) => row.reviewStatus === "NEEDS_REVIEW")
        : sortedRows;

  const staleRows = actionableRows.filter((row) => row.freshness === "STALE");
  const needsReviewRows = actionableRows.filter((row) => row.reviewStatus === "NEEDS_REVIEW");

  return {
    rows: rows.slice(0, limit).map(({ rowIndex: _rowIndex, sortTimestamp: _sortTimestamp, ...row }) => row),
    summary: {
      staleApprovalsCount: staleRows.length,
      needsReviewCount: needsReviewRows.length,
      blockedQuestionnairesCount: new Set(staleRows.map((row) => row.questionnaireId)).size
    }
  };
}
