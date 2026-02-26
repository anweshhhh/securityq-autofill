import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunker";

describe("chunkText", () => {
  it("returns no chunks for empty extracted text", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps critical tokens intact when the raw split point lands mid-token", () => {
    const text =
      "Databases are encrypted at rest using AES-256 and stored with KMS-managed keys. External traffic requires TLS 1.2+.";
    const chunks = chunkText(text, { maxChars: 40, overlapChars: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => /\bAES-256\b/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk) => /\bKMS-managed\b/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk) => /TLS 1\.2\+/.test(chunk.content))).toBe(true);
  });

  it("produces sequential chunk indices with non-empty content", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const chunks = chunkText(text, { maxChars: 18, overlapChars: 4 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk, index) => chunk.chunkIndex === index)).toBe(true);
    expect(chunks.every((chunk) => chunk.content.length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.content === chunk.content.trim())).toBe(true);
  });
});
