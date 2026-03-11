"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";

type ApprovedAnswerDetail = {
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

type ApprovedAnswerDetailDrawerProps = {
  approvedAnswerId: string | null;
  onClose: () => void;
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

function parseApprovedAnswerDetail(payload: unknown): ApprovedAnswerDetail | null {
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
    sourceQuestionnaireId: typeof candidate.sourceQuestionnaireId === "string" ? candidate.sourceQuestionnaireId : null,
    sourceItemId: typeof candidate.sourceItemId === "string" ? candidate.sourceItemId : null
  };
}

export function ApprovedAnswerDetailDrawer({
  approvedAnswerId,
  onClose
}: ApprovedAnswerDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState<ApprovedAnswerDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useFocusTrap({
    active: Boolean(approvedAnswerId),
    containerRef: drawerRef,
    onEscape: onClose
  });

  useEffect(() => {
    if (!approvedAnswerId) {
      setDetail(null);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setDetail(null);
    setErrorMessage("");
    setIsLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/approved-answers/${approvedAnswerId}?detail=library`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: {
                message?: unknown;
              };
            }
          | null;

        if (!response.ok) {
          if (cancelled) {
            return;
          }

          if (response.status === 404) {
            setErrorMessage("Approved answer is no longer available.");
          } else if (response.status === 401 || response.status === 403) {
            setErrorMessage("Approved answer details are unavailable.");
          } else {
            setErrorMessage(
              typeof payload?.error?.message === "string" ? payload.error.message : "Failed to load approved answer details."
            );
          }
          setDetail(null);
          return;
        }

        const parsedDetail = parseApprovedAnswerDetail(payload);
        if (cancelled) {
          return;
        }

        if (!parsedDetail) {
          setErrorMessage("Approved answer details are unavailable.");
          setDetail(null);
          return;
        }

        setDetail(parsedDetail);
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setDetail(null);
        setErrorMessage(error instanceof Error ? error.message : "Failed to load approved answer details.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [approvedAnswerId]);

  if (!approvedAnswerId) {
    return null;
  }

  return (
    <div
      className="overlay-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approved-answer-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="overlay-modal-card"
        ref={drawerRef}
        tabIndex={-1}
        style={{
          alignSelf: "stretch",
          marginLeft: "auto",
          width: "min(560px, 100%)",
          maxHeight: "100%",
          overflowY: "auto",
          display: "grid",
          gap: 16
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start"
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <h2 id="approved-answer-detail-title" style={{ margin: 0 }}>
              Approved answer
            </h2>
            <span style={{ color: "var(--muted-text)" }}>
              Inspect trust metadata for this reusable claim without leaving the library.
            </span>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {isLoading ? <div style={{ color: "var(--muted-text)" }}>Loading approved answer details…</div> : null}
        {!isLoading && errorMessage ? <div className="message-banner error">{errorMessage}</div> : null}

        {!isLoading && !errorMessage && detail ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap"
              }}
            >
              <Badge tone={detail.freshness === "STALE" ? "review" : "approved"}>
                {detail.freshness === "STALE" ? "Stale" : "Fresh"}
              </Badge>
              {detail.sourceQuestionnaireId ? (
                <Link href={`/questionnaires/${detail.sourceQuestionnaireId}`} className="btn btn-ghost">
                  Open source questionnaire
                </Link>
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
        ) : null}
      </div>
    </div>
  );
}
