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
    <div style={{ display: "grid", gap: 20 }}>
      {startReviewHref ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Link href={startReviewHref} className="btn btn-primary">
            Start review
          </Link>
        </div>
      ) : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12
        }}
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

      <TrustQueueQuestionnaireGroups
        groups={queue.questionnaireGroups}
        queueFilter={activeFilter}
        queueQuery={query}
      />

      <Card>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
            Showing {queue.rows.length} actionable item{queue.rows.length === 1 ? "" : "s"}
          </div>

          <form method="GET" action="/trust-queue" style={{ display: "grid", gap: 12 }}>
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Trust queue filters">
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

      <TrustQueueTable rows={queue.rows} queueFilter={activeFilter} queueQuery={query} />
    </div>
  );
}
