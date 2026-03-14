import Link from "next/link";
import { redirect } from "next/navigation";
import { ApprovedAnswersLibraryTable } from "@/components/ApprovedAnswersLibraryTable";
import { Card, Button, TextInput, cx } from "@/components/ui";
import { getRequestContext, RequestContextError } from "@/lib/requestContext";
import {
  listApprovedAnswersForOrg,
  type ApprovedAnswersLibraryFreshness
} from "@/server/approvedAnswers/listApprovedAnswers";
import { assertCan, RbacAction } from "@/server/rbac";

type ApprovedAnswersSearchParams = {
  q?: string | string[];
  freshness?: string | string[];
};

const FRESHNESS_OPTIONS: Array<{ value: "all" | "fresh" | "stale"; label: string }> = [
  {
    value: "all",
    label: "All"
  },
  {
    value: "fresh",
    label: "Fresh"
  },
  {
    value: "stale",
    label: "Stale"
  }
];

function readSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function normalizeFreshness(value: string): ApprovedAnswersLibraryFreshness {
  const normalized = value.trim().toLowerCase();
  if (normalized === "fresh") {
    return "FRESH";
  }

  if (normalized === "stale") {
    return "STALE";
  }

  return "ALL";
}

function buildFilterHref(query: string, freshness: "all" | "fresh" | "stale"): string {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }

  if (freshness !== "all") {
    params.set("freshness", freshness);
  }

  const next = params.toString();
  return next ? `/review/library?${next}` : "/review/library";
}

export default async function ApprovedAnswersPage({
  searchParams
}: {
  searchParams?: ApprovedAnswersSearchParams | Promise<ApprovedAnswersSearchParams>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const query = readSearchParam(resolvedSearchParams.q).trim();
  const freshnessParam = readSearchParam(resolvedSearchParams.freshness).trim().toLowerCase();
  const freshness = normalizeFreshness(freshnessParam);
  const activeFreshness = freshnessParam === "fresh" || freshnessParam === "stale" ? freshnessParam : "all";
  let ctx;
  try {
    ctx = await getRequestContext();
  } catch (error) {
    if (error instanceof RequestContextError && error.status === 401) {
      const callbackParams = new URLSearchParams();
      if (query) {
        callbackParams.set("q", query);
      }
      if (activeFreshness !== "all") {
        callbackParams.set("freshness", activeFreshness);
      }

      const callbackPath = callbackParams.toString()
        ? `/review/library?${callbackParams.toString()}`
        : "/review/library";
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
    }

    throw error;
  }

  assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

  const library = await listApprovedAnswersForOrg(ctx, {
    query,
    freshness,
    limit: 50
  });

  return (
    <div className="page-stack">
      <Card className="hero-panel hero-panel-compact">
        <div className="hero-panel-copy">
          <span className="eyebrow">Review library</span>
          <h2 style={{ margin: 0 }}>Turn strong reviewer decisions into a reusable answer system.</h2>
          <p className="muted hero-panel-text" style={{ margin: 0 }}>
            Fresh approvals become the building blocks for faster future questionnaires, with provenance and reuse
            signals intact.
          </p>
        </div>
        <div className="hero-panel-insights">
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Total</span>
            <strong>{library.counts.total}</strong>
            <span className="hero-mini-helper">Approved answers in the library</span>
          </div>
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Fresh</span>
            <strong>{library.counts.fresh}</strong>
            <span className="hero-mini-helper">Ready for confident reuse</span>
          </div>
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Stale</span>
            <strong>{library.counts.stale}</strong>
            <span className="hero-mini-helper">Needs re-validation</span>
          </div>
        </div>
      </Card>

      <Card className="section-shell">
        <div className="card-title-row">
          <div className="section-copy">
            <span className="section-kicker">Filters</span>
            <div>
              <h3 style={{ margin: 0 }}>Library scope</h3>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                Search reusable answers or isolate stale entries that need another pass.
              </p>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
            Showing {library.rows.length} of {library.counts.total}
          </div>

          <form
            method="GET"
            action="/review/library"
            style={{
              display: "grid",
              gap: 12
            }}
          >
            <div className="toolbar-row filter-toolbar">
              <TextInput
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search approved answers"
                style={{ flex: "1 1 280px", minWidth: 0 }}
              />
              <input type="hidden" name="freshness" value={activeFreshness} />
              <Button type="submit" variant="primary">
                Apply
              </Button>
              <Link href="/review/library" className="btn btn-ghost">
                Clear
              </Link>
            </div>
          </form>

          <div className="toolbar-row" aria-label="Freshness filters">
            {FRESHNESS_OPTIONS.map((option) => {
              const active = option.value === activeFreshness;
              return (
                <Link
                  key={option.value}
                  href={buildFilterHref(query, option.value)}
                  className={cx("btn", active ? "btn-primary" : "btn-ghost")}
                  aria-current={active ? "page" : undefined}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="section-copy">
        <span className="section-kicker">Library entries</span>
        <h3 style={{ margin: 0 }}>Approved answers with freshness, provenance, and reuse signals</h3>
      </div>

      <ApprovedAnswersLibraryTable rows={library.rows} />
    </div>
  );
}
