import { describe, expect, it } from "vitest";
import {
  buildTrustQueueSessionHref,
  normalizeTrustQueueSessionFilterParam,
  toTrustQueueFilter
} from "@/shared/trustQueueSessionLinks";

describe("normalizeTrustQueueSessionFilterParam", () => {
  it("keeps valid filter params", () => {
    expect(normalizeTrustQueueSessionFilterParam("stale")).toBe("stale");
    expect(normalizeTrustQueueSessionFilterParam("needs-review")).toBe("needs-review");
  });

  it("falls back invalid filter params to all", () => {
    expect(normalizeTrustQueueSessionFilterParam("bogus")).toBe("all");
    expect(normalizeTrustQueueSessionFilterParam("")).toBe("all");
    expect(normalizeTrustQueueSessionFilterParam(null)).toBe("all");
  });
});

describe("buildTrustQueueSessionHref", () => {
  it("builds a questionnaire deeplink with session params", () => {
    expect(
      buildTrustQueueSessionHref({
        questionnaireId: "questionnaire-1",
        itemId: "question-9",
        rowFilter: "stale",
        queueFilter: "all",
        queueQuery: "Vendor Alpha"
      })
    ).toBe(
      "/questionnaires/questionnaire-1?itemId=question-9&filter=stale&source=review&queueFilter=all&queueQuery=Vendor+Alpha"
    );
  });

  it("omits queueQuery when empty", () => {
    expect(
      buildTrustQueueSessionHref({
        questionnaireId: "questionnaire-1",
        itemId: "question-9",
        rowFilter: "needs-review",
        queueFilter: "needs-review",
        queueQuery: "   "
      })
    ).toBe(
      "/questionnaires/questionnaire-1?itemId=question-9&filter=needs-review&source=review&queueFilter=needs-review"
    );
  });
});

describe("toTrustQueueFilter", () => {
  it("maps public filter params to trust queue filters", () => {
    expect(toTrustQueueFilter("all")).toBe("ALL");
    expect(toTrustQueueFilter("stale")).toBe("STALE");
    expect(toTrustQueueFilter("needs-review")).toBe("NEEDS_REVIEW");
  });

  it("falls back invalid values to ALL", () => {
    expect(toTrustQueueFilter("bogus")).toBe("ALL");
    expect(toTrustQueueFilter("")).toBe("ALL");
    expect(toTrustQueueFilter(null)).toBe("ALL");
  });
});
