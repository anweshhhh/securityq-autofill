import { describe, expect, it } from "vitest";
import { buildQuestionnaireExportCsv } from "./export";

describe("questionnaire export csv", () => {
  it("preserves original column order and appends answer columns", () => {
    const csv = buildQuestionnaireExportCsv(
      ["Control ID", "Question", "Notes"],
      [
        {
          sourceRow: {
            "Control ID": "ENC-1",
            Question: 'Is "TLS" enabled, globally?',
            Notes: "Transit encryption"
          },
          answer: "Yes",
          citations: [
            {
              docName: "Doc A",
              chunkId: "chunk-7",
              quotedSnippet: "TLS 1.2+"
            }
          ],
          confidence: "high",
          needsReview: false
        }
      ]
    );

    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      '"Control ID","Question","Notes","Answer","Citations","Confidence","Needs Review"'
    );

    expect(lines[1]).toContain('"ENC-1"');
    expect(lines[1]).toContain('"Is ""TLS"" enabled, globally?"');
    expect(lines[1]).toContain('"Yes"');
    expect(lines[1]).toContain('"Doc A#chunk-7:""TLS 1.2+"""');
    expect(lines[1]).toContain('"false"');
  });
});
