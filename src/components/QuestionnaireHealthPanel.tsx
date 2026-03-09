"use client";

import { CompactStatCard } from "@/components/CompactStatCard";
import { Badge, Button, Card } from "@/components/ui";

type QuestionnaireHealthPanelProps = {
  totalCount: number;
  approvedCount: number;
  needsReviewCount: number;
  staleCount: number;
  reusedCount: number;
  onFixBlockers: () => void;
  exportApprovedOnlyReady: boolean;
};

export function QuestionnaireHealthPanel({
  totalCount,
  approvedCount,
  needsReviewCount,
  staleCount,
  reusedCount,
  onFixBlockers,
  exportApprovedOnlyReady
}: QuestionnaireHealthPanelProps) {
  const hasBlockers = staleCount > 0 || needsReviewCount > 0;
  const reusedApprovedPercent = approvedCount > 0 ? Math.round((reusedCount / approvedCount) * 100) : 0;
  const ctaLabel = hasBlockers ? "Fix blockers" : "All set";

  return (
    <Card className="questionnaire-health-panel">
      <div className="questionnaire-health-header">
        <div>
          <h3 style={{ margin: 0 }}>Health</h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Trust readiness for this questionnaire.
          </p>
        </div>
        <div className="questionnaire-health-actions">
          <Badge tone={exportApprovedOnlyReady ? "approved" : "review"}>
            Approved-only export: {exportApprovedOnlyReady ? "Ready" : "Blocked"}
          </Badge>
          <Button type="button" variant="secondary" onClick={onFixBlockers} disabled={!hasBlockers}>
            {ctaLabel}
          </Button>
        </div>
      </div>

      <div className="compact-stats-grid questionnaire-health-grid">
        <CompactStatCard label="Total questions" value={totalCount} />
        <CompactStatCard label="Approved" value={approvedCount} tone="success" />
        <CompactStatCard label="Needs review" value={needsReviewCount} tone={needsReviewCount > 0 ? "warning" : "neutral"} />
        <CompactStatCard label="Stale approvals" value={staleCount} tone={staleCount > 0 ? "danger" : "neutral"} />
        <CompactStatCard
          label="Reused approvals"
          value={reusedCount}
          sublabel={`${reusedApprovedPercent}% of approved`}
          tone={reusedCount > 0 ? "neutral" : "default"}
        />
      </div>
    </Card>
  );
}
