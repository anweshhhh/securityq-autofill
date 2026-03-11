import Link from "next/link";
import { redirect } from "next/navigation";
import { CompactStatCard } from "@/components/CompactStatCard";
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
  return next ? `/approved-answers?${next}` : "/approved-answers";
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
        ? `/approved-answers?${callbackParams.toString()}`
        : "/approved-answers";
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
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ display: "grid", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Approved Answers</h1>
        <p style={{ margin: 0, color: "var(--muted-text)", maxWidth: "72ch" }}>
          Browse approved answers across the active workspace and inspect freshness, reuse, and provenance metadata
          before you reuse a claim.
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12
        }}
      >
        <CompactStatCard label="Total" value={library.counts.total} />
        <CompactStatCard label="Fresh" value={library.counts.fresh} tone="success" />
        <CompactStatCard label="Stale" value={library.counts.stale} tone={library.counts.stale > 0 ? "danger" : "neutral"} />
      </section>

      <Card>
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap"
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <strong>Filter library</strong>
              <span style={{ color: "var(--muted-text)" }}>
                Search answer text or question text, then narrow by freshness.
              </span>
            </div>
            <div style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
              Showing {library.rows.length} of {library.counts.total}
            </div>
          </div>

          <form
            method="GET"
            action="/approved-answers"
            style={{
              display: "grid",
              gap: 12
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center"
              }}
            >
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
              <Link href="/approved-answers" className="btn btn-ghost">
                Clear
              </Link>
            </div>
          </form>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Freshness filters">
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

      {library.counts.total > library.rows.length ? (
        <Card>
          <div style={{ color: "var(--muted-text)" }}>
            Showing the first {library.rows.length} approved answers in this filtered view. Refine the search to narrow
            the list further.
          </div>
        </Card>
      ) : null}

      <ApprovedAnswersLibraryTable rows={library.rows} />
    </div>
  );
}
