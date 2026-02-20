import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker";

describe("chunkText", () => {
  it("splits text into deterministic overlapping chunks", () => {
    const chunks = chunkText("abcdefghijklmnopqrstuvwxyz", {
      maxChars: 10,
      overlapChars: 2
    });

    expect(chunks).toEqual([
      { chunkIndex: 0, content: "abcdefghij" },
      { chunkIndex: 1, content: "ijklmnopqr" },
      { chunkIndex: 2, content: "qrstuvwxyz" }
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("throws for invalid overlap settings", () => {
    expect(() => chunkText("abc", { maxChars: 3, overlapChars: 3 })).toThrow(
      "overlapChars must be >= 0 and less than maxChars"
    );
  });
});
