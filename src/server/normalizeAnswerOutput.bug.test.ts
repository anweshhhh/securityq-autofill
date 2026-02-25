import { describe, expect, it } from "vitest";
import { normalizeAnswerOutput } from "@/server/answerEngine";

// BUG REPRO: sufficiency=true and grounded draft is semantically correct,
// but normalization rewrites answer to NOT_SPECIFIED because claim-check
// requires lexical token containment against quoted snippets.
describe("normalizeAnswerOutput bug repro", () => {
  it("should keep a correct grounded TLS draft instead of overwriting to Not specified", () => {
    const normalized = normalizeAnswerOutput({
      modelAnswer: "Yes, data is encrypted in transit. The minimum TLS version enforced is TLS 1.2.",
      modelConfidence: "high",
      modelNeedsReview: false,
      modelHadFormatViolation: false,
      sufficiencySufficient: true,
      missingPoints: [],
      citations: [
        {
          docName: "Evidence A",
          chunkId: "chunk-1",
          quotedSnippet: "Q: Do you encrypt data in transit? A: Yes. External interfaces require TLS 1.2+."
        },
        {
          docName: "Evidence B",
          chunkId: "chunk-2",
          quotedSnippet: "Public APIs terminate SSL/TLS at the edge (minimum TLS 1.2)."
        }
      ]
    });

    // Expected: keep grounded draft content (or equivalent non-template answer).
    expect(normalized.answer).not.toBe("Not specified in provided documents.");
  });
});
