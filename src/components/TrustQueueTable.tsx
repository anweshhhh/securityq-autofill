import Link from "next/link";
import type { TrustQueueRow } from "@/server/trustQueue/listTrustQueueItems";
import {
  buildTrustQueueSessionHref,
  type TrustQueueSessionFilterParam
} from "@/shared/trustQueueSessionLinks";
import { Badge, Card } from "@/components/ui";

type TrustQueueTableProps = {
  rows: TrustQueueRow[];
  queueFilter?: TrustQueueSessionFilterParam;
  queueQuery?: string;
};

function formatApprovedAt(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "n/a";
  }

  return new Date(parsed).toLocaleString();
}

function statusTone(status: TrustQueueRow["reviewStatus"]): "approved" | "review" | "draft" {
  if (status === "APPROVED") {
    return "approved";
  }

  if (status === "NEEDS_REVIEW") {
    return "review";
  }

  return "draft";
}

function statusLabel(status: TrustQueueRow["reviewStatus"]): string {
  if (status === "APPROVED") {
    return "Approved";
  }

  if (status === "NEEDS_REVIEW") {
    return "Needs review";
  }

  return "Open";
}

function priorityTone(priority: TrustQueueRow["priority"]): "review" | "draft" {
  return priority === "P1" ? "review" : "draft";
}

function buildReviewHref(
  row: TrustQueueRow,
  queueFilter: TrustQueueSessionFilterParam,
  queueQuery?: string
): string {
  return buildTrustQueueSessionHref({
    questionnaireId: row.questionnaireId,
    itemId: row.itemId,
    rowFilter: row.freshness === "STALE" ? "stale" : "needs-review",
    queueFilter,
    queueQuery
  });
}

export function TrustQueueTable({
  rows,
  queueFilter = "all",
  queueQuery
}: TrustQueueTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ display: "grid", gap: 6 }}>
          <strong>No trust blockers right now.</strong>
          <span style={{ color: "var(--muted-text)" }}>
            Stale approvals and needs-review items will appear here as work enters the queue.
          </span>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ color: "var(--muted-text)", fontSize: "0.92rem" }}>
        P1 stale approved · P2 needs review in blocked questionnaire · P3 other needs review
      </div>
      {rows.map((row) => (
        <Card key={row.itemId}>
          <div
            style={{
              display: "grid",
              gap: 14
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "flex-start",
                flexWrap: "wrap"
              }}
            >
              <div style={{ display: "grid", gap: 6, maxWidth: "76ch" }}>
                <strong style={{ fontSize: "1rem" }}>{row.questionPreview || "Question unavailable."}</strong>
                <span style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>{row.questionnaireName}</span>
              </div>
              <div className="toolbar-row compact">
                <Badge tone={priorityTone(row.priority)}>{row.priority}</Badge>
                <Badge tone={statusTone(row.reviewStatus)}>{statusLabel(row.reviewStatus)}</Badge>
                {row.freshness ? (
                  <Badge tone={row.freshness === "STALE" ? "review" : "approved"}>
                    {row.freshness === "STALE" ? "Stale" : "Fresh"}
                  </Badge>
                ) : null}
                <Link href={buildReviewHref(row, queueFilter, queueQuery)} className="btn btn-secondary">
                  Review item
                </Link>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Review status
                </span>
                <span>{statusLabel(row.reviewStatus)}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Freshness</span>
                <span>{row.freshness ? (row.freshness === "STALE" ? "Stale" : "Fresh") : "n/a"}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Approved at</span>
                <span>{formatApprovedAt(row.approvedAt)}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Export readiness
                </span>
                <span>{row.isBlockedForApprovedOnlyExport ? "Blocked" : "Clear"}</span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
