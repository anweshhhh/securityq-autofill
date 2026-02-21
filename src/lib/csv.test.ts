import { describe, expect, it } from "vitest";
import { buildCsvPreview, parseCsvText, suggestQuestionColumn } from "./csv";

describe("csv parser", () => {
  it("handles BOM, quoted commas, and quoted newlines", () => {
    const csv =
      "\uFEFFQuestion,Notes\n" +
      '"Is data encrypted at rest?","Includes KMS, AES-256"\n' +
      '"Do you log access?","First line\nSecond line"\n';

    const parsed = parseCsvText(csv);

    expect(parsed.headers).toEqual(["Question", "Notes"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]["Notes"]).toBe("Includes KMS, AES-256");
    expect(parsed.rows[1]["Notes"]).toBe("First line\nSecond line");
  });

  it("disambiguates duplicate headers", () => {
    const parsed = parseCsvText("Question,Question,Req\nA,B,C\n");

    expect(parsed.headers).toEqual(["Question", "Question (2)", "Req"]);
    expect(parsed.rows[0]["Question"]).toBe("A");
    expect(parsed.rows[0]["Question (2)"]).toBe("B");
  });

  it("builds preview and suggests question column", () => {
    const parsed = parseCsvText("Control ID,Security Question,Notes\nENC-1,Q1,N1\nENC-2,Q2,N2\n");
    const preview = buildCsvPreview(parsed);

    expect(preview.totalRowCount).toBe(2);
    expect(preview.previewRows).toHaveLength(2);
    expect(preview.suggestedQuestionColumn).toBe("Security Question");
    expect(suggestQuestionColumn(parsed.headers)).toBe("Security Question");
  });
});
