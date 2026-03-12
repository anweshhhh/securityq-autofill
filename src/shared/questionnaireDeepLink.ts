type SearchParamsReader = {
  get(name: string): string | null;
};

export type QuestionnaireDeepLink = {
  itemId: string | null;
  filter: "all" | "stale" | "needs-review" | null;
};

function normalizeItemId(value: string | null): string | null {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeFilter(value: string | null): QuestionnaireDeepLink["filter"] {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "all" || normalized === "stale" || normalized === "needs-review") {
    return normalized;
  }

  return null;
}

export function parseQuestionnaireDeepLink(searchParams?: SearchParamsReader | null): QuestionnaireDeepLink {
  return {
    itemId: normalizeItemId(searchParams?.get("itemId") ?? null),
    filter: normalizeFilter(searchParams?.get("filter") ?? null)
  };
}
