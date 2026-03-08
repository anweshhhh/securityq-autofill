export type QuestionnaireStaleItem = {
  questionnaireItemId: string;
  rowIndex: number | null;
};

export type ExportBlockedStaleError = {
  staleCount: number;
  staleItems: QuestionnaireStaleItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseQuestionnaireStaleItems(value: unknown): QuestionnaireStaleItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.questionnaireItemId !== "string") {
        return null;
      }

      return {
        questionnaireItemId: item.questionnaireItemId,
        rowIndex: typeof item.rowIndex === "number" ? item.rowIndex : null
      };
    })
    .filter((item): item is QuestionnaireStaleItem => item !== null);
}

export function parseQuestionnaireStalenessPayload(payload: unknown): ExportBlockedStaleError | null {
  if (!isRecord(payload)) {
    return null;
  }

  const staleItems = parseQuestionnaireStaleItems(payload.staleItems);
  const rawStaleCount = payload.staleCount;
  const staleCount =
    typeof rawStaleCount === "number" && Number.isFinite(rawStaleCount)
      ? Math.max(0, Math.trunc(rawStaleCount))
      : staleItems.length;

  return {
    staleCount: Math.max(staleCount, staleItems.length),
    staleItems
  };
}

export function buildExportBlockedMessage(staleCount: number): string {
  return `${staleCount} approved answer${staleCount === 1 ? "" : "s"} ${
    staleCount === 1 ? "is" : "are"
  } stale and ${staleCount === 1 ? "needs" : "need"} review.`;
}

export function parseExportBlockedError(status: number, payload: unknown): ExportBlockedStaleError | null {
  if (status !== 409 || !isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  if (payload.error.code !== "EXPORT_BLOCKED_STALE_APPROVALS") {
    return null;
  }

  return parseQuestionnaireStalenessPayload(payload.error.details) ?? {
    staleCount: 0,
    staleItems: []
  };
}
