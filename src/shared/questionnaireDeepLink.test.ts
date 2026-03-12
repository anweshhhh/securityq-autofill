import { describe, expect, it } from "vitest";
import { parseQuestionnaireDeepLink } from "@/shared/questionnaireDeepLink";

describe("parseQuestionnaireDeepLink", () => {
  it("parses a valid itemId and stale filter", () => {
    const parsed = parseQuestionnaireDeepLink(
      new URLSearchParams({
        itemId: "question-123",
        filter: "stale"
      })
    );

    expect(parsed).toEqual({
      itemId: "question-123",
      filter: "stale"
    });
  });

  it("drops invalid filters while preserving a valid itemId", () => {
    const parsed = parseQuestionnaireDeepLink(
      new URLSearchParams({
        itemId: "question-123",
        filter: "bogus"
      })
    );

    expect(parsed).toEqual({
      itemId: "question-123",
      filter: null
    });
  });

  it("supports filter-only deep links", () => {
    const parsed = parseQuestionnaireDeepLink(
      new URLSearchParams({
        filter: "needs-review"
      })
    );

    expect(parsed).toEqual({
      itemId: null,
      filter: "needs-review"
    });
  });

  it("normalizes empty values to null", () => {
    const parsed = parseQuestionnaireDeepLink(
      new URLSearchParams({
        itemId: "   ",
        filter: ""
      })
    );

    expect(parsed).toEqual({
      itemId: null,
      filter: null
    });
  });
});
