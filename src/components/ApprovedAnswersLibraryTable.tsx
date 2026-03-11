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
      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((row) => {
          const active = selectedApprovedAnswerId === row.approvedAnswerId;

          return (
            <Card
              key={row.approvedAnswerId}
              style={{
                borderColor: active ? "rgba(37, 99, 235, 0.32)" : undefined,
                boxShadow: active ? "0 0 0 1px rgba(37, 99, 235, 0.12)" : undefined
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedApprovedAnswerId(row.approvedAnswerId)}
                aria-haspopup="dialog"
                aria-expanded={active}
                style={{
                  width: "100%",
                  display: "grid",
                  gap: 14,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  textAlign: "left",
                  cursor: "pointer"
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
                    <strong style={{ fontSize: "1rem" }}>{row.answerPreview || "No approved answer text."}</strong>
                    <span style={{ color: "var(--muted-text)", fontSize: "0.95rem" }}>
                      Click to inspect freshness, provenance, and stale-reason metadata.
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
