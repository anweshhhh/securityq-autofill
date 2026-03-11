import Link from "next/link";
import type { ApprovedAnswersLibraryRow } from "@/server/approvedAnswers/listApprovedAnswers";
import { Badge, Card } from "@/components/ui";

type ApprovedAnswersLibraryTableProps = {
  rows: ApprovedAnswersLibraryRow[];
};

function formatApprovedAt(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "n/a";
  }

  return new Date(parsed).toLocaleString();
}

function renderBoolean(value: boolean): string {
  return value ? "Yes" : "No";
}

export function ApprovedAnswersLibraryTable({ rows }: ApprovedAnswersLibraryTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ display: "grid", gap: 6 }}>
          <strong>No approved answers yet.</strong>
          <span style={{ color: "var(--muted-text)" }}>
            Approve answers in the questionnaire review workbench to build the reusable claims library.
          </span>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {rows.map((row) => (
        <Card key={row.approvedAnswerId}>
          <div style={{ display: "grid", gap: 14 }}>
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
                <strong style={{ fontSize: "1rem" }}>{row.answerPreview || "No approved answer text."}</strong>
                <span style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
                  Approved answer library entry
                </span>
              </div>
              <Badge tone={row.freshness === "STALE" ? "review" : "approved"}>
                {row.freshness === "STALE" ? "Stale" : "Fresh"}
              </Badge>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Approved at</span>
                <span>{formatApprovedAt(row.approvedAt)}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Snapshotted citations
                </span>
                <span>{row.snapshottedCitationsCount}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Reused</span>
                <span>{renderBoolean(row.reused)}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Suggestion-assisted
                </span>
                <span>{renderBoolean(row.suggestionAssisted)}</span>
              </div>
            </div>

            {row.sourceQuestionnaireId ? (
              <div>
                <Link href={`/questionnaires/${row.sourceQuestionnaireId}`} className="btn btn-ghost">
                  Open source questionnaire
                </Link>
              </div>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
