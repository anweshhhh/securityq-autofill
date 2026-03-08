import { describe, expect, it } from "vitest";
import {
  buildExportBlockedMessage,
  parseExportBlockedError,
  parseQuestionnaireStalenessPayload
} from "@/shared/exportErrors";

describe("exportErrors", () => {
  it("parses stale export blocks from a 409 JSON envelope", () => {
    const parsed = parseExportBlockedError(409, {
      error: {
        code: "EXPORT_BLOCKED_STALE_APPROVALS",
        message: "Export blocked: some approved answers are stale and need review.",
        details: {
          staleCount: 2,
          staleItems: [
            { questionnaireItemId: "question-1", rowIndex: 0 },
            { questionnaireItemId: "question-2", rowIndex: 4 }
          ]
        }
      }
    });

    expect(parsed).toEqual({
      staleCount: 2,
      staleItems: [
        { questionnaireItemId: "question-1", rowIndex: 0 },
        { questionnaireItemId: "question-2", rowIndex: 4 }
      ]
    });
  });

  it("ignores non-blocking export errors", () => {
    expect(
      parseExportBlockedError(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Bad request."
        }
      })
    ).toBeNull();

    expect(
      parseExportBlockedError(409, {
        error: {
          code: "CONFLICT",
          message: "Different conflict."
        }
      })
    ).toBeNull();
  });

  it("normalizes staleness payloads and falls back to item count", () => {
    expect(
      parseQuestionnaireStalenessPayload({
        staleItems: [{ questionnaireItemId: "question-7", rowIndex: "ignored" }]
      })
    ).toEqual({
      staleCount: 1,
      staleItems: [{ questionnaireItemId: "question-7", rowIndex: null }]
    });
  });

  it("builds the blocked export message", () => {
    expect(buildExportBlockedMessage(1)).toBe("1 approved answer is stale and needs review.");
    expect(buildExportBlockedMessage(3)).toBe("3 approved answers are stale and need review.");
  });
});
