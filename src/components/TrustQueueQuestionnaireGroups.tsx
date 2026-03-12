import Link from "next/link";
import type { TrustQueueQuestionnaireGroup } from "@/server/trustQueue/listTrustQueueItems";
import { Badge, Card } from "@/components/ui";

type TrustQueueQuestionnaireGroupsProps = {
  groups: TrustQueueQuestionnaireGroup[];
};

function groupTone(group: TrustQueueQuestionnaireGroup): "review" | "draft" {
  return group.blocked ? "review" : "draft";
}

function groupLabel(group: TrustQueueQuestionnaireGroup): string {
  return group.blocked ? "Blocked" : "Needs review";
}

export function TrustQueueQuestionnaireGroups({ groups }: TrustQueueQuestionnaireGroupsProps) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <Card>
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong>Blocked questionnaires</strong>
          <span style={{ color: "var(--muted-text)" }}>
            Triage questionnaire-level blockers before drilling into specific stale or needs-review items.
          </span>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {groups.map((group) => (
            <div
              key={group.questionnaireId}
              style={{
                display: "grid",
                gap: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--border-color)"
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
                <div style={{ display: "grid", gap: 4, maxWidth: "70ch" }}>
                  <strong style={{ fontSize: "1rem" }}>{group.questionnaireName}</strong>
                  <span style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
                    {group.staleCount > 0
                      ? "Approved-only export is blocked until stale answers are reviewed."
                      : "This questionnaire still has needs-review work pending."}
                  </span>
                </div>
                <div className="toolbar-row compact">
                  <Badge tone={groupTone(group)}>{groupLabel(group)}</Badge>
                  <Link href={`/questionnaires/${group.questionnaireId}`} className="btn btn-secondary">
                    Open questionnaire
                  </Link>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 12
                }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                    Stale items
                  </span>
                  <span>{group.staleCount}</span>
                </div>
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                    Needs review
                  </span>
                  <span>{group.needsReviewCount}</span>
                </div>
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                    Blocked
                  </span>
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
