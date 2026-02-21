import { describe, expect, it } from "vitest";
import {
  NOT_SPECIFIED_RESPONSE_TEXT,
  applyClaimCheckGuardrails,
  findUnsupportedKeyTokens
} from "./claimCheck";

describe("claim check guardrails", () => {
  it("flags unsupported vendor tokens and downgrades to low confidence", () => {
    const unsupported = findUnsupportedKeyTokens({
      answer: "Data is encrypted with AWS KMS.",
      quotedSnippets: ["Data is encrypted at rest and in transit."]
    });

    expect(unsupported).toContain("aws");
    expect(unsupported).toContain("kms");

    const guarded = applyClaimCheckGuardrails({
      answer: "Data is encrypted with AWS KMS.",
      quotedSnippets: ["Data is encrypted at rest and in transit."],
      confidence: "high",
      needsReview: false
    });

    expect(guarded.answer).toBe(NOT_SPECIFIED_RESPONSE_TEXT);
    expect(guarded.confidence).toBe("low");
    expect(guarded.needsReview).toBe(true);
  });

  it("prevents unsupported requirement claims for partial evidence", () => {
    const guarded = applyClaimCheckGuardrails({
      answer: "MFA is required for all users.",
      quotedSnippets: ["MFA is enabled for user accounts."],
      confidence: "high",
      needsReview: false
    });

    expect(guarded.answer).toBe(NOT_SPECIFIED_RESPONSE_TEXT);
    expect(guarded.confidence).toBe("low");
    expect(guarded.needsReview).toBe(true);
    expect(guarded.unsupportedTokens).toContain("required");
  });
});
