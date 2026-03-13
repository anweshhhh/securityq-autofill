import Link from "next/link";
import { redirect } from "next/navigation";
import { CompactStatCard } from "@/components/CompactStatCard";
import { TrustQueueQuestionnaireGroups } from "@/components/TrustQueueQuestionnaireGroups";
import { TrustQueueTable } from "@/components/TrustQueueTable";
import { Button, Card, TextInput, cx } from "@/components/ui";
import { getRequestContext, RequestContextError } from "@/lib/requestContext";
import {
  listTrustQueueItemsForOrg,
  type TrustQueueFilter
} from "@/server/trustQueue/listTrustQueueItems";
import { getTrustQueueSessionForOrg } from "@/server/trustQueue/getTrustQueueSession";
import { assertCan, RbacAction } from "@/server/rbac";
import {
  buildTrustQueueSessionHref,
  normalizeTrustQueueSessionFilterParam,
  toTrustQueueFilter,
  type TrustQueueSessionFilterParam
} from "@/shared/trustQueueSessionLinks";

type TrustQueueSearchParams = {
  q?: string | string[];
  filter?: string | string[];
};

const FILTER_OPTIONS: Array<{ value: "all" | "stale" | "needs-review"; label: string }> = [
  {
    value: "all",
    label: "All"
  },
  {
    value: "stale",
    label: "Stale"
  },
  {
    value: "needs-review",
    label: "Needs review"
  }
];

function readSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function buildFilterHref(query: string, filter: TrustQueueSessionFilterParam): string {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }

  if (filter !== "all") {
    params.set("filter", filter);
  }

  const next = params.toString();
  return next ? `/trust-queue?${next}` : "/trust-queue";
}

export default async function TrustQueuePage({
  searchParams
}: {
  searchParams?: TrustQueueSearchParams | Promise<TrustQueueSearchParams>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const query = readSearchParam(resolvedSearchParams.q).trim();
  const activeFilter = normalizeTrustQueueSessionFilterParam(readSearchParam(resolvedSearchParams.filter));
  const filter: TrustQueueFilter = toTrustQueueFilter(activeFilter);

  let ctx;
  try {
    ctx = await getRequestContext();
  } catch (error) {
    if (error instanceof RequestContextError && error.status === 401) {
      const callbackParams = new URLSearchParams();
      if (query) {
        callbackParams.set("q", query);
      }
      if (activeFilter !== "all") {
        callbackParams.set("filter", activeFilter);
      }

      const callbackPath = callbackParams.toString()
        ? `/trust-queue?${callbackParams.toString()}`
        : "/trust-queue";
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
    }

    throw error;
  }

  assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

  const queue = await listTrustQueueItemsForOrg(ctx, {
    query,
    filter,
    limit: 100
  });
  const reviewSession = await getTrustQueueSessionForOrg(ctx, {
    query,
    filter: activeFilter,
    currentItemId: null
  });
  const startReviewHref = reviewSession.firstItem
    ? buildTrustQueueSessionHref({
        questionnaireId: reviewSession.firstItem.questionnaireId,
        itemId: reviewSession.firstItem.itemId,
        rowFilter: reviewSession.firstItem.rowFilter,
        queueFilter: activeFilter,
        queueQuery: query
      })
    : null;

  return (
    <div className="page-stack">
      <Card className="hero-panel hero-panel-compact">
        <div className="hero-panel-copy">
          <span className="eyebrow">Trust queue</span>
          <h2 style={{ margin: 0 }}>Focus reviewers on the answers that could break confidence first.</h2>
          <p className="muted hero-panel-text" style={{ margin: 0 }}>
            Stale approvals and unresolved review states surface here before they turn into export blockers.
          </p>
          {startReviewHref ? (
            <div className="toolbar-row hero-action-row">
              <Link href={startReviewHref} className="btn btn-primary">
                Start review
              </Link>
            </div>
          ) : null}
        </div>
        <div className="hero-panel-insights">
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Stale approvals</span>
            <strong>{queue.summary.staleApprovalsCount}</strong>
            <span className="hero-mini-helper">Approved answers that drifted</span>
          </div>
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Needs review</span>
            <strong>{queue.summary.needsReviewCount}</strong>
            <span className="hero-mini-helper">Questions still awaiting decisions</span>
          </div>
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Blocked questionnaires</span>
            <strong>{queue.summary.blockedQuestionnairesCount}</strong>
            <span className="hero-mini-helper">Workflows slowed by trust debt</span>
          </div>
        </div>
      </Card>

      <section
        className="compact-stats-grid questionnaire-insight-grid"
        aria-label="Trust queue summary"
      >
        <CompactStatCard
          label="Stale approvals"
          value={queue.summary.staleApprovalsCount}
          tone={queue.summary.staleApprovalsCount > 0 ? "danger" : "neutral"}
        />
        <CompactStatCard
          label="Needs review"
          value={queue.summary.needsReviewCount}
          tone={queue.summary.needsReviewCount > 0 ? "warning" : "neutral"}
        />
        <CompactStatCard
          label="Blocked questionnaires"
          value={queue.summary.blockedQuestionnairesCount}
          tone={queue.summary.blockedQuestionnairesCount > 0 ? "danger" : "neutral"}
        />
      </section>

      <Card className="section-shell">
        <div className="card-title-row">
          <div className="section-copy">
            <span className="section-kicker">Filters</span>
            <div>
              <h3 style={{ margin: 0 }}>Review scope</h3>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                Narrow the queue before you enter the review workbench.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
            Showing {queue.rows.length} actionable item{queue.rows.length === 1 ? "" : "s"}
          </div>

          <form method="GET" action="/trust-queue" style={{ display: "grid", gap: 12 }}>
            <div className="toolbar-row filter-toolbar">
              <TextInput
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search questionnaires"
                style={{ flex: "1 1 280px", minWidth: 0 }}
              />
              <input type="hidden" name="filter" value={activeFilter} />
              <Button type="submit" variant="primary">
                Apply
              </Button>
              <Link href="/trust-queue" className="btn btn-ghost">
                Clear
              </Link>
            </div>
          </form>

          <div className="toolbar-row" aria-label="Trust queue filters">
            {FILTER_OPTIONS.map((option) => {
              const active = option.value === activeFilter;
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

      {queue.questionnaireGroups.length > 0 ? (
        <div className="section-copy">
          <span className="section-kicker">Blocked questionnaires</span>
          <h3 style={{ margin: 0 }}>Start with the workflows carrying the most risk.</h3>
        </div>
      ) : null}

      <TrustQueueQuestionnaireGroups
        groups={queue.questionnaireGroups}
        queueFilter={activeFilter}
        queueQuery={query}
      />

      <div className="section-copy">
        <span className="section-kicker">Actionable items</span>
        <h3 style={{ margin: 0 }}>Priority-ordered review queue</h3>
      </div>

      <TrustQueueTable rows={queue.rows} queueFilter={activeFilter} queueQuery={query} />
    </div>
  );
}
