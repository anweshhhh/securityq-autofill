import Link from "next/link";
import type { TrustQueueQuestionnaireGroup } from "@/server/trustQueue/listTrustQueueItems";
import {
  buildTrustQueueSessionHref,
  type TrustQueueSessionFilterParam
} from "@/shared/trustQueueSessionLinks";
import { Badge, Card } from "@/components/ui";

type TrustQueueQuestionnaireGroupsProps = {
  groups: TrustQueueQuestionnaireGroup[];
  queueFilter?: TrustQueueSessionFilterParam;
  queueQuery?: string;
};

function groupTone(group: TrustQueueQuestionnaireGroup): "review" | "draft" {
  return group.blocked ? "review" : "draft";
}

function groupLabel(group: TrustQueueQuestionnaireGroup): string {
  return group.blocked ? "Blocked" : "Needs review";
}

function buildQuestionnaireHref(
  group: TrustQueueQuestionnaireGroup,
  queueFilter: TrustQueueSessionFilterParam,
  queueQuery?: string
): string {
  if (!group.firstActionableItemId || !group.firstActionableFilter) {
    return `/questionnaires/${group.questionnaireId}`;
  }

  return buildTrustQueueSessionHref({
    questionnaireId: group.questionnaireId,
    itemId: group.firstActionableItemId,
    rowFilter: group.firstActionableFilter,
    queueFilter,
    queueQuery
  });
}

export function TrustQueueQuestionnaireGroups({
  groups,
  queueFilter = "all",
  queueQuery
}: TrustQueueQuestionnaireGroupsProps) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <Card className="section-shell">
      <div className="review-stack">
        <div className="review-stack-list">
          {groups.map((group) => (
            <div key={group.questionnaireId} className="review-card review-card-compact">
              <div className="review-card-header">
                <div className="review-card-copy">
                  <strong className="review-card-title">{group.questionnaireName}</strong>
                  <span className="small muted">Resolve the highest-risk items before reopening exports.</span>
                </div>
                <div className="toolbar-row compact">
                  <Badge tone={groupTone(group)}>{groupLabel(group)}</Badge>
                  <Link
                    href={buildQuestionnaireHref(group, queueFilter, queueQuery)}
                    className="btn btn-secondary"
                  >
                    Open questionnaire
                  </Link>
                </div>
              </div>

              <div className="review-meta-grid">
                <div className="review-meta-item">
                  <span className="review-meta-label">Stale items</span>
                  <span>{group.staleCount}</span>
                </div>
                <div className="review-meta-item">
                  <span className="review-meta-label">Needs review</span>
                  <span>{group.needsReviewCount}</span>
                </div>
                <div className="review-meta-item">
                  <span className="review-meta-label">Blocked</span>
                  <span>{group.blocked ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
