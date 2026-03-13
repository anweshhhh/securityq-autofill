import { prisma } from "@/lib/prisma";
import { findStaleApprovedAnswerIds } from "@/server/approvedAnswers/staleness";

export type TrustQueueFilter = "ALL" | "STALE" | "NEEDS_REVIEW";
export type TrustQueuePriority = "P1" | "P2" | "P3";

export type TrustQueueRow = {
  questionnaireId: string;
  questionnaireName: string;
  itemId: string;
  questionPreview: string;
  reviewStatus: "NEEDS_REVIEW" | "APPROVED" | "OTHER";
  freshness: "FRESH" | "STALE" | null;
  approvedAt: string | null;
  isBlockedForApprovedOnlyExport: boolean;
  priority: TrustQueuePriority;
};

export type TrustQueueQuestionnaireGroup = {
  questionnaireId: string;
  questionnaireName: string;
  staleCount: number;
  needsReviewCount: number;
  blocked: boolean;
};

export type TrustQueueResult = {
  rows: TrustQueueRow[];
  summary: {
    staleApprovalsCount: number;
    needsReviewCount: number;
    blockedQuestionnairesCount: number;
  };
  questionnaireGroups: TrustQueueQuestionnaireGroup[];
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

function buildQuestionnaireGroups(
  rows: Array<
    TrustQueueRow & {
      rowIndex: number;
      sortTimestamp: number;
    }
  >
): TrustQueueQuestionnaireGroup[] {
  const groups = new Map<string, TrustQueueQuestionnaireGroup>();

  for (const row of rows) {
    const existing = groups.get(row.questionnaireId);
    const next: TrustQueueQuestionnaireGroup = existing ?? {
      questionnaireId: row.questionnaireId,
      questionnaireName: row.questionnaireName,
      staleCount: 0,
      needsReviewCount: 0,
      blocked: false
    };

    if (row.freshness === "STALE") {
      next.staleCount += 1;
      next.blocked = true;
    }

    if (row.reviewStatus === "NEEDS_REVIEW") {
      next.needsReviewCount += 1;
    }

    groups.set(row.questionnaireId, next);
  }

  return Array.from(groups.values())
    .filter((group) => group.staleCount > 0 || group.needsReviewCount > 0)
    .sort((left, right) => {
      if (left.blocked !== right.blocked) {
        return left.blocked ? -1 : 1;
      }

      if (left.staleCount !== right.staleCount) {
        return right.staleCount - left.staleCount;
      }

      if (left.needsReviewCount !== right.needsReviewCount) {
        return right.needsReviewCount - left.needsReviewCount;
      }

      return left.questionnaireName.localeCompare(right.questionnaireName);
    });
}

function getTrustQueuePriority(params: {
  freshness: TrustQueueRow["freshness"];
  reviewStatus: TrustQueueRow["reviewStatus"];
  isBlockedForApprovedOnlyExport: boolean;
}): TrustQueuePriority {
  if (params.freshness === "STALE") {
    return "P1";
  }

  if (params.reviewStatus === "NEEDS_REVIEW" && params.isBlockedForApprovedOnlyExport) {
    return "P2";
  }

  return "P3";
}

function priorityRank(priority: TrustQueuePriority): number {
  if (priority === "P1") {
    return 0;
  }

  if (priority === "P2") {
    return 1;
  }

  return 2;
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
      },
      questionnaireGroups: []
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

  const blockedQuestionnaireIds = new Set(
    actionableRows
      .filter((row) => row.freshness === "STALE")
      .map((row) => row.questionnaireId)
  );

  const prioritizedRows = actionableRows.map((row) => {
    const isBlockedForApprovedOnlyExport = blockedQuestionnaireIds.has(row.questionnaireId);

    return {
      ...row,
      isBlockedForApprovedOnlyExport,
      priority: getTrustQueuePriority({
        freshness: row.freshness,
        reviewStatus: row.reviewStatus,
        isBlockedForApprovedOnlyExport
      })
    };
  });

  const sortedRows = prioritizedRows.sort((left, right) => {
    const leftPriority = priorityRank(left.priority);
    const rightPriority = priorityRank(right.priority);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (left.isBlockedForApprovedOnlyExport !== right.isBlockedForApprovedOnlyExport) {
      return left.isBlockedForApprovedOnlyExport ? -1 : 1;
    }

    if (left.sortTimestamp !== right.sortTimestamp) {
      return right.sortTimestamp - left.sortTimestamp;
    }

    // Keep ties deterministic when priority and relevant timestamps match.
    if (left.questionnaireName !== right.questionnaireName) {
      return left.questionnaireName.localeCompare(right.questionnaireName);
    }

    if (left.questionPreview !== right.questionPreview) {
      return left.questionPreview.localeCompare(right.questionPreview);
    }

    return left.rowIndex - right.rowIndex;
  });

  const rows =
    filter === "STALE"
      ? sortedRows.filter((row) => row.freshness === "STALE")
      : filter === "NEEDS_REVIEW"
        ? sortedRows.filter((row) => row.reviewStatus === "NEEDS_REVIEW")
        : sortedRows;

  const staleRows = prioritizedRows.filter((row) => row.freshness === "STALE");
  const needsReviewRows = prioritizedRows.filter((row) => row.reviewStatus === "NEEDS_REVIEW");
  const questionnaireGroups = buildQuestionnaireGroups(prioritizedRows);

  return {
    rows: rows.slice(0, limit).map(({ rowIndex: _rowIndex, sortTimestamp: _sortTimestamp, ...row }) => row),
    summary: {
      staleApprovalsCount: staleRows.length,
      needsReviewCount: needsReviewRows.length,
      blockedQuestionnairesCount: new Set(staleRows.map((row) => row.questionnaireId)).size
    },
    questionnaireGroups
  };
}
