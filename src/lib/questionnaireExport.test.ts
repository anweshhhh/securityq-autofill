import { describe, expect, it } from "vitest";
import { buildQuestionnaireExportCsv, formatCitationsCompact } from "./questionnaireExport";

describe("questionnaire CSV export helpers", () => {
  it("formats citations compactly and truncates long snippets", () => {
    const longSnippet = "a".repeat(220);

    const formatted = formatCitationsCompact([
      {
        docName: "Doc One",
        chunkId: "chunk-1",
        quotedSnippet: longSnippet
      },
      {
        docName: "Doc Two",
        chunkId: "chunk-2",
        quotedSnippet: "second snippet"
      }
    ]);

    expect(formatted).toContain("Doc One#chunk-1");
    expect(formatted).toContain("Doc Two#chunk-2");
    expect(formatted).toContain("…");
    expect(formatted.length).toBeLessThanOrEqual(700);
  });

  it("escapes CSV fields and appends answer columns", () => {
    const csv = buildQuestionnaireExportCsv(
      ["Question", "Control ID"],
      [
        {
          sourceRow: {
            Question: 'Is "TLS" enabled, globally?',
            "Control ID": "ENC-1"
          },
          answer: "Yes",
          citations: [
            {
              docName: "Doc A",
              chunkId: "chunk-9",
              quotedSnippet: "TLS 1.2 or higher"
            }
          ],
          confidence: "high",
          needsReview: false
        }
      ]
    );

    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      '"Question","Control ID","Answer","Citations","Confidence","Needs Review"'
    );
    expect(lines[1]).toContain('"Is ""TLS"" enabled, globally?"');
    expect(lines[1]).toContain('"Doc A#chunk-9: ""TLS 1.2 or higher"""');
    expect(lines[1]).toContain('"false"');
  });
});
