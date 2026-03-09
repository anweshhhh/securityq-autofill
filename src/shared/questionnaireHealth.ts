export type QuestionnaireHealthItem = {
  reviewStatus: "DRAFT" | "APPROVED" | "NEEDS_REVIEW";
  reusedFromApprovedAnswerId: string | null;
};

export type QuestionnaireHealthSummary = {
  totalCount: number;
  approvedCount: number;
  needsReviewCount: number;
  staleCount: number;
  reusedCount: number;
  reusedApprovedPercent: number;
  exportApprovedOnlyReady: boolean;
};

export function computeQuestionnaireHealth(
  items: QuestionnaireHealthItem[],
  staleCount: number
): QuestionnaireHealthSummary {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let reusedCount = 0;

  for (const item of items) {
    if (item.reviewStatus === "APPROVED") {
      approvedCount += 1;
      if (item.reusedFromApprovedAnswerId) {
        reusedCount += 1;
      }
    }

    if (item.reviewStatus === "NEEDS_REVIEW") {
      needsReviewCount += 1;
    }
  }

  return {
    totalCount: items.length,
    approvedCount,
    needsReviewCount,
    staleCount,
    reusedCount,
    reusedApprovedPercent: approvedCount > 0 ? Math.round((reusedCount / approvedCount) * 100) : 0,
    exportApprovedOnlyReady: staleCount === 0
  };
}
