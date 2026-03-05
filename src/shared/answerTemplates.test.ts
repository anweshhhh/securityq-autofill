import { describe, expect, it } from "vitest";
import {
  canonicalizeAnswerOutput,
  NOT_FOUND_TEXT,
  PARTIAL_TEXT
} from "@/shared/answerTemplates";

describe("answer template canonicalization", () => {
  it("normalizes NOT_FOUND variants and clears citations", () => {
    const result = canonicalizeAnswerOutput({
      text: "  Not found in provided documents.  ",
      citations: [{ chunkId: "chunk-1" }]
    });

    expect(result).toEqual({
      text: NOT_FOUND_TEXT,
      citations: [],
      kind: "NOT_FOUND"
    });
  });

  it("normalizes PARTIAL variants and preserves citations", () => {
    const citations = [{ chunkId: "chunk-1" }];
    const result = canonicalizeAnswerOutput({
      text: "not specified in provided documents.",
      citations
    });

    expect(result).toEqual({
      text: PARTIAL_TEXT,
      citations,
      kind: "PARTIAL"
    });
  });

  it("downgrades FOUND answers with empty citations to NOT_FOUND", () => {
    const result = canonicalizeAnswerOutput({
      text: "Yes, we enforce MFA.",
      citations: []
    });

    expect(result).toEqual({
      text: NOT_FOUND_TEXT,
      citations: [],
      kind: "NOT_FOUND"
    });
  });
});
