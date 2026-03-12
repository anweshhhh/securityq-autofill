"use client";

import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";

export type ApprovedAnswerDetail = {
  approvedAnswerId: string;
  answerText: string;
  approvedAt: string;
  freshness: "FRESH" | "STALE";
  snapshottedCitationsCount: number;
  reused: boolean;
  suggestionAssisted: boolean;
  staleReasonSummary: null | {
    affectedCitationsCount: number;
    changedCount: number;
    missingCount: number;
  };
  sourceQuestionnaireId: string | null;
  sourceItemId: string | null;
};

type ApprovedAnswerDetailContentProps = {
  detail: ApprovedAnswerDetail;
  currentQuestionText?: string | null;
  applyAction?: {
    label: string;
    pendingLabel: string;
    onApply: () => Promise<void> | void;
    disabled?: boolean;
    pending?: boolean;
  };
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

export function parseApprovedAnswerDetail(payload: unknown): ApprovedAnswerDetail | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const staleReasonSummaryCandidate =
    candidate.staleReasonSummary && typeof candidate.staleReasonSummary === "object"
      ? (candidate.staleReasonSummary as Record<string, unknown>)
      : null;

  if (
    typeof candidate.approvedAnswerId !== "string" ||
    typeof candidate.answerText !== "string" ||
    typeof candidate.approvedAt !== "string" ||
    (candidate.freshness !== "FRESH" && candidate.freshness !== "STALE") ||
    typeof candidate.snapshottedCitationsCount !== "number" ||
    typeof candidate.reused !== "boolean" ||
    typeof candidate.suggestionAssisted !== "boolean"
  ) {
    return null;
  }

  return {
    approvedAnswerId: candidate.approvedAnswerId,
    answerText: candidate.answerText,
    approvedAt: candidate.approvedAt,
    freshness: candidate.freshness,
    snapshottedCitationsCount: candidate.snapshottedCitationsCount,
    reused: candidate.reused,
    suggestionAssisted: candidate.suggestionAssisted,
    staleReasonSummary:
      staleReasonSummaryCandidate &&
      typeof staleReasonSummaryCandidate.affectedCitationsCount === "number" &&
      typeof staleReasonSummaryCandidate.changedCount === "number" &&
      typeof staleReasonSummaryCandidate.missingCount === "number"
        ? {
            affectedCitationsCount: staleReasonSummaryCandidate.affectedCitationsCount,
            changedCount: staleReasonSummaryCandidate.changedCount,
            missingCount: staleReasonSummaryCandidate.missingCount
          }
        : null,
    sourceQuestionnaireId:
      typeof candidate.sourceQuestionnaireId === "string" ? candidate.sourceQuestionnaireId : null,
    sourceItemId: typeof candidate.sourceItemId === "string" ? candidate.sourceItemId : null
  };
}

export function ApprovedAnswerDetailContent({
  detail,
  currentQuestionText,
  applyAction
}: ApprovedAnswerDetailContentProps) {
  return (
    <>
      {currentQuestionText ? (
        <Card>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Current question</strong>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{currentQuestionText}</div>
          </div>
        </Card>
      ) : null}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div className="toolbar-row compact">
          <Badge tone={detail.freshness === "STALE" ? "review" : "approved"}>
            {detail.freshness === "STALE" ? "Stale" : "Fresh"}
          </Badge>
          {detail.sourceQuestionnaireId ? (
            <Link href={`/questionnaires/${detail.sourceQuestionnaireId}`} className="btn btn-ghost">
              Open source questionnaire
            </Link>
          ) : null}
        </div>

        {applyAction ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void applyAction.onApply()}
            disabled={applyAction.disabled}
          >
            {applyAction.pending ? applyAction.pendingLabel : applyAction.label}
          </Button>
        ) : null}
      </div>

      <Card>
        <div style={{ display: "grid", gap: 8 }}>
          <strong>Answer</strong>
          <div
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--text-color)"
            }}
          >
            {detail.answerText || "No approved answer text."}
          </div>
        </div>
      </Card>

      <Card>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Freshness</span>
            <span>{detail.freshness === "STALE" ? "Stale" : "Fresh"}</span>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Approved at</span>
            <span>{formatApprovedAt(detail.approvedAt)}</span>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
              Snapshotted citations
            </span>
            <span>{detail.snapshottedCitationsCount}</span>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>Reused</span>
            <span>{renderBoolean(detail.reused)}</span>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
              Suggestion-assisted
            </span>
            <span>{renderBoolean(detail.suggestionAssisted)}</span>
          </div>
        </div>
      </Card>

      {detail.staleReasonSummary ? (
        <Card>
          <div style={{ display: "grid", gap: 10 }}>
            <strong>Why stale</strong>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Affected citations
                </span>
                <span>{detail.staleReasonSummary.affectedCitationsCount}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Changed evidence
                </span>
                <span>{detail.staleReasonSummary.changedCount}</span>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ color: "var(--muted-text)", fontSize: "0.82rem", fontWeight: 600 }}>
                  Missing evidence
                </span>
                <span>{detail.staleReasonSummary.missingCount}</span>
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </>
  );
}
