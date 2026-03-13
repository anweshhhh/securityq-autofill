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
    <div className="review-stack">
      <div className="utility-caption">
        P1 stale approved · P2 needs review in blocked questionnaire · P3 other needs review
      </div>
      {rows.map((row) => (
        <Card key={row.itemId} className="review-card">
          <div className="review-card-header">
            <div className="review-card-copy">
              <strong className="review-card-title">{row.questionPreview || "Question unavailable."}</strong>
              <span className="review-card-subtitle">{row.questionnaireName}</span>
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

          <div className="review-meta-grid">
            <div className="review-meta-item">
              <span className="review-meta-label">Review status</span>
              <span>{statusLabel(row.reviewStatus)}</span>
            </div>
            <div className="review-meta-item">
              <span className="review-meta-label">Freshness</span>
              <span>{row.freshness ? (row.freshness === "STALE" ? "Stale" : "Fresh") : "n/a"}</span>
            </div>
            <div className="review-meta-item">
              <span className="review-meta-label">Approved at</span>
              <span>{formatApprovedAt(row.approvedAt)}</span>
            </div>
          </div>

          <div className="review-callout">
            <span className="review-callout-label">Why it is here</span>
            <span>
              {row.freshness === "STALE"
                ? "An approved answer has drifted against its cited evidence."
                : row.reviewStatus === "NEEDS_REVIEW"
                  ? "This question still needs a reviewer decision."
                  : "This item is still open in the queue."}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
