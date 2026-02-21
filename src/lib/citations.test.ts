import { describe, expect, it } from "vitest";
import { formatCitationsCompact } from "./citations";

describe("citation formatter", () => {
  it("formats multiple citations with separators", () => {
    const value = formatCitationsCompact([
      {
        docName: "Doc A",
        chunkId: "chunk-1",
        quotedSnippet: "TLS 1.2 is required"
      },
      {
        docName: "Doc B",
        chunkId: "chunk-2",
        quotedSnippet: "Backups are encrypted"
      }
    ]);

    expect(value).toContain('Doc A#chunk-1:"TLS 1.2 is required"');
    expect(value).toContain('Doc B#chunk-2:"Backups are encrypted"');
    expect(value).toContain(" | ");
  });

  it("truncates long citation output", () => {
    const longSnippet = "a".repeat(5000);
    const value = formatCitationsCompact([
      {
        docName: "Doc A",
        chunkId: "chunk-1",
        quotedSnippet: longSnippet
      }
    ]);

    expect(value.length).toBeLessThanOrEqual(1200);
    expect(value).toContain("…");
  });
});
