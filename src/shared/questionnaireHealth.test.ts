import { describe, expect, it } from "vitest";
import { computeQuestionnaireHealth } from "@/shared/questionnaireHealth";

describe("computeQuestionnaireHealth", () => {
  it("computes questionnaire health metrics from loaded items and stale count", () => {
    const summary = computeQuestionnaireHealth(
      [
        { reviewStatus: "APPROVED", reusedFromApprovedAnswerId: "approved-1" },
        { reviewStatus: "APPROVED", reusedFromApprovedAnswerId: null },
        { reviewStatus: "NEEDS_REVIEW", reusedFromApprovedAnswerId: "approved-2" },
        { reviewStatus: "DRAFT", reusedFromApprovedAnswerId: null }
      ],
      2
    );

    expect(summary).toEqual({
      totalCount: 4,
      approvedCount: 2,
      needsReviewCount: 1,
      staleCount: 2,
      reusedCount: 1,
      reusedApprovedPercent: 50,
      exportApprovedOnlyReady: false
    });
  });

  it("treats reused approvals as a subset of approved questions", () => {
    const summary = computeQuestionnaireHealth(
      [
        { reviewStatus: "NEEDS_REVIEW", reusedFromApprovedAnswerId: "approved-1" },
        { reviewStatus: "DRAFT", reusedFromApprovedAnswerId: "approved-2" }
      ],
      0
    );

    expect(summary.reusedCount).toBe(0);
    expect(summary.reusedApprovedPercent).toBe(0);
    expect(summary.exportApprovedOnlyReady).toBe(true);
  });
});
