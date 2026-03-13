import Link from "next/link";
import { Badge, Card } from "@/components/ui";

export type TrustQueueReviewSessionBannerProps = {
  currentPriority: "P1" | "P2" | "P3";
  nextHref: string | null;
};

function priorityTone(priority: TrustQueueReviewSessionBannerProps["currentPriority"]): "review" | "draft" {
  return priority === "P1" ? "review" : "draft";
}

export function TrustQueueReviewSessionBanner({
  currentPriority,
  nextHref
}: TrustQueueReviewSessionBannerProps) {
  const nextItemHref = nextHref ?? null;

  return (
    <Card className="card-muted">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div className="toolbar-row compact" style={{ alignItems: "center" }}>
            <strong>Reviewing from Trust Queue</strong>
            <Badge tone={priorityTone(currentPriority)}>{currentPriority}</Badge>
          </div>
          <span className="small muted">
            {nextItemHref
              ? "Stay in the queue and move to the next blocker when you are ready."
              : "No more queue items."}
          </span>
        </div>

        {nextItemHref ? (
          <Link href={nextItemHref} className="btn btn-secondary">
            Next item
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
