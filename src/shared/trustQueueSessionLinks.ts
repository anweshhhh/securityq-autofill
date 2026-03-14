export type TrustQueueSessionFilterParam = "all" | "stale" | "needs-review";
export type TrustQueueSessionRowFilter = "stale" | "needs-review";

export function normalizeTrustQueueSessionFilterParam(
  value: string | null | undefined
): TrustQueueSessionFilterParam {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "stale" || normalized === "needs-review") {
    return normalized;
  }

  return "all";
}

export function toTrustQueueFilter(value: string | null | undefined): "ALL" | "STALE" | "NEEDS_REVIEW" {
  const normalized = normalizeTrustQueueSessionFilterParam(value);
  if (normalized === "stale") {
    return "STALE";
  }

  if (normalized === "needs-review") {
    return "NEEDS_REVIEW";
  }

  return "ALL";
}

export function buildTrustQueueSessionHref(params: {
  questionnaireId: string;
  itemId: string;
  rowFilter: TrustQueueSessionRowFilter;
  queueFilter: TrustQueueSessionFilterParam;
  queueQuery?: string | null;
}): string {
  const searchParams = new URLSearchParams({
    itemId: params.itemId,
    filter: params.rowFilter,
    source: "review",
    queueFilter: params.queueFilter
  });

  const queueQuery = (params.queueQuery ?? "").trim();
  if (queueQuery.length > 0) {
    searchParams.set("queueQuery", queueQuery);
  }

  return `/questionnaires/${params.questionnaireId}?${searchParams.toString()}`;
}
