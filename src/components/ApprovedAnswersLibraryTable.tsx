"use client";

import { useState } from "react";
import type { ApprovedAnswersLibraryRow } from "@/server/approvedAnswers/listApprovedAnswers";
import { ApprovedAnswerDetailDrawer } from "@/components/ApprovedAnswerDetailDrawer";
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
  const [selectedApprovedAnswerId, setSelectedApprovedAnswerId] = useState<string | null>(null);

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
    <>
      <div className="review-stack">
        {rows.map((row) => {
          const active = selectedApprovedAnswerId === row.approvedAnswerId;

          return (
            <Card
              key={row.approvedAnswerId}
              className={active ? "review-card review-card-active" : "review-card"}
            >
              <button
                type="button"
                onClick={() => setSelectedApprovedAnswerId(row.approvedAnswerId)}
                aria-haspopup="dialog"
                aria-expanded={active}
                className="review-card-button"
              >
                <div className="review-card-header">
                  <div className="review-card-copy">
                    <strong className="review-card-title">{row.answerPreview || "No approved answer text."}</strong>
                    <span className="review-card-subtitle">
                      Open the detail view to inspect citations, provenance, and reuse context.
                    </span>
                  </div>
                  <Badge tone={row.freshness === "STALE" ? "review" : "approved"}>
                    {row.freshness === "STALE" ? "Stale" : "Fresh"}
                  </Badge>
                </div>

                <div className="review-meta-grid">
                  <div className="review-meta-item">
                    <span className="review-meta-label">Approved at</span>
                    <span>{formatApprovedAt(row.approvedAt)}</span>
                  </div>
                  <div className="review-meta-item">
                    <span className="review-meta-label">Snapshotted citations</span>
                    <span>{row.snapshottedCitationsCount}</span>
                  </div>
                  <div className="review-meta-item">
                    <span className="review-meta-label">Reused</span>
                    <span>{renderBoolean(row.reused)}</span>
                  </div>
                  <div className="review-meta-item">
                    <span className="review-meta-label">Suggestion-assisted</span>
                    <span>{renderBoolean(row.suggestionAssisted)}</span>
                  </div>
                </div>
              </button>
            </Card>
          );
        })}
      </div>

      <ApprovedAnswerDetailDrawer
        approvedAnswerId={selectedApprovedAnswerId}
        onClose={() => setSelectedApprovedAnswerId(null)}
      />
    </>
  );
}
