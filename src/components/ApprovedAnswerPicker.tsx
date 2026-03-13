"use client";

import { useEffect, useRef, useState } from "react";
import {
  ApprovedAnswerDetailContent,
  parseApprovedAnswerDetail,
  type ApprovedAnswerDetail
} from "@/components/ApprovedAnswerDetailContent";
import { Badge, Button, Card, TextInput } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";

type PickerRow = {
  approvedAnswerId: string;
  answerPreview: string;
  approvedAt: string;
  snapshottedCitationsCount: number;
  reused: boolean;
  suggestionAssisted: boolean;
};

type PickerPayload = {
  rows?: Array<{
    approvedAnswerId?: unknown;
    answerPreview?: unknown;
    approvedAt?: unknown;
    snapshottedCitationsCount?: unknown;
    reused?: unknown;
    suggestionAssisted?: unknown;
  }>;
  counts?: {
    total?: unknown;
  };
  error?: {
    message?: unknown;
  };
};

type ApprovedAnswerPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  onApply: (approvedAnswerId: string) => Promise<{ ok: boolean; message?: string }>;
  applyingApprovedAnswerId: string | null;
  currentQuestionText: string;
};

function formatApprovedAt(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "n/a";
  }

  return new Date(parsed).toLocaleString();
}

function normalizeRows(value: PickerPayload["rows"]): PickerRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => {
      if (
        typeof row?.approvedAnswerId !== "string" ||
        typeof row.answerPreview !== "string" ||
        typeof row.approvedAt !== "string"
      ) {
        return null;
      }

      return {
        approvedAnswerId: row.approvedAnswerId,
        answerPreview: row.answerPreview,
        approvedAt: row.approvedAt,
        snapshottedCitationsCount:
          typeof row.snapshottedCitationsCount === "number" ? row.snapshottedCitationsCount : 0,
        reused: row.reused === true,
        suggestionAssisted: row.suggestionAssisted === true
      };
    })
    .filter((row): row is PickerRow => row !== null);
}

export function ApprovedAnswerPicker({
  isOpen,
  onClose,
  onApply,
  applyingApprovedAnswerId,
  currentQuestionText
}: ApprovedAnswerPickerProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [searchText, setSearchText] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [previewApprovedAnswerId, setPreviewApprovedAnswerId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<ApprovedAnswerDetail | null>(null);
  const [previewErrorMessage, setPreviewErrorMessage] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  async function handleApplyApprovedAnswer(approvedAnswerId: string) {
    setErrorMessage("");
    const result = await onApply(approvedAnswerId);
    if (result.ok) {
      onClose();
      return;
    }

    if (result.message) {
      setErrorMessage(result.message);
    }
  }

  useFocusTrap({
    active: isOpen,
    containerRef: modalRef,
    onEscape: onClose
  });

  useEffect(() => {
    if (!isOpen) {
      setSearchText("");
      setSubmittedQuery("");
      setRows([]);
      setResultCount(0);
      setErrorMessage("");
      setIsLoading(false);
      setPreviewApprovedAnswerId(null);
      setPreviewDetail(null);
      setPreviewErrorMessage("");
      setIsPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setErrorMessage("");

    async function loadApprovedAnswers() {
      try {
        const params = new URLSearchParams({
          freshness: "fresh",
          limit: "20"
        });

        if (submittedQuery.trim()) {
          params.set("q", submittedQuery.trim());
        }

        const response = await fetch(`/api/approved-answers?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as PickerPayload;

        if (!active) {
          return;
        }

        if (!response.ok) {
          if (response.status === 401) {
            setRows([]);
            setResultCount(0);
            return;
          }

          setErrorMessage(
            typeof payload.error?.message === "string"
              ? payload.error.message
              : "Failed to load approved answers."
          );
          setRows([]);
          setResultCount(0);
          return;
        }

        const nextRows = normalizeRows(payload.rows);
        setRows(nextRows);
        setResultCount(typeof payload.counts?.total === "number" ? payload.counts.total : nextRows.length);
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setRows([]);
        setResultCount(0);
        setErrorMessage(error instanceof Error ? error.message : "Failed to load approved answers.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadApprovedAnswers();

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, submittedQuery]);

  useEffect(() => {
    if (!isOpen || !previewApprovedAnswerId) {
      setPreviewDetail(null);
      setPreviewErrorMessage("");
      setIsPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setPreviewDetail(null);
    setPreviewErrorMessage("");
    setIsPreviewLoading(true);

    async function loadPreview() {
      try {
        const response = await fetch(`/api/approved-answers/${previewApprovedAnswerId}?detail=library`, {
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

        if (!active) {
          return;
        }

        if (!response.ok) {
          if (response.status === 404) {
            setPreviewErrorMessage("Approved answer is no longer available.");
          } else if (response.status === 401 || response.status === 403) {
            setPreviewErrorMessage("Approved answer details are unavailable.");
          } else {
            setPreviewErrorMessage(
              typeof payload?.error?.message === "string"
                ? payload.error.message
                : "Failed to load approved answer details."
            );
          }
          setPreviewDetail(null);
          return;
        }

        const parsedDetail = parseApprovedAnswerDetail(payload);
        if (!parsedDetail) {
          setPreviewErrorMessage("Approved answer details are unavailable.");
          setPreviewDetail(null);
          return;
        }

        setPreviewDetail(parsedDetail);
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setPreviewDetail(null);
        setPreviewErrorMessage(error instanceof Error ? error.message : "Failed to load approved answer details.");
      } finally {
        if (active) {
          setIsPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, previewApprovedAnswerId]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="overlay-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approved-answer-picker-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="overlay-modal-card"
        ref={modalRef}
        tabIndex={-1}
        style={{
          width: "min(920px, 100%)",
          display: "grid",
          gap: 16,
          maxHeight: "min(780px, calc(100vh - 32px))"
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
            <h3 id="approved-answer-picker-title" style={{ margin: 0 }}>
              Browse library
            </h3>
            <span className="small muted">
              Search fresh approved answers in the current workspace, preview them, and apply one to this draft.
            </span>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedQuery(searchText);
          }}
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <TextInput
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search fresh approved answers"
            style={{ flex: "1 1 260px", minWidth: 0 }}
          />
          <Button type="submit" variant="secondary" disabled={isLoading}>
            Search
          </Button>
        </form>

        {errorMessage ? <div className="message-banner error">{errorMessage}</div> : null}
        {isLoading ? (
          <div className="small muted">Loading fresh approved answers...</div>
        ) : (
          <div className="small muted">Showing {rows.length} of {resultCount} fresh approved answers.</div>
        )}

        {previewApprovedAnswerId ? (
          <Card>
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
                <div style={{ display: "grid", gap: 4 }}>
                  <strong>Preview</strong>
                  <span className="small muted">
                    Inspect this approved answer in context before applying it to the current draft.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPreviewApprovedAnswerId(null);
                  }}
                >
                  Close preview
                </Button>
              </div>

              {isPreviewLoading ? <div className="small muted">Loading approved answer details...</div> : null}
              {!isPreviewLoading && previewErrorMessage ? (
                <div className="message-banner error">{previewErrorMessage}</div>
              ) : null}
              {!isPreviewLoading && !previewErrorMessage && previewDetail ? (
                <ApprovedAnswerDetailContent
                  detail={previewDetail}
                  currentQuestionText={currentQuestionText}
                  applyAction={{
                    label: "Apply this answer",
                    pendingLabel: "Applying...",
                    onApply: () => handleApplyApprovedAnswer(previewDetail.approvedAnswerId),
                    disabled: Boolean(applyingApprovedAnswerId),
                    pending: applyingApprovedAnswerId === previewDetail.approvedAnswerId
                  }}
                />
              ) : null}
            </div>
          </Card>
        ) : null}

        <div style={{ display: "grid", gap: 10, overflowY: "auto", paddingRight: 4 }}>
          {!isLoading && rows.length === 0 ? (
            <Card>
              <div className="small muted">No fresh approved answers found.</div>
            </Card>
          ) : null}

          {rows.map((row) => (
            <Card key={row.approvedAnswerId}>
              <div style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                    flexWrap: "wrap"
                  }}
                >
                  <div style={{ display: "grid", gap: 6, maxWidth: "72ch" }}>
                    <strong>{row.answerPreview || "No approved answer text."}</strong>
                    <div className="toolbar-row compact">
                      <span className="small muted">Approved {formatApprovedAt(row.approvedAt)}</span>
                      <Badge tone="draft">
                        {row.snapshottedCitationsCount} citation{row.snapshottedCitationsCount === 1 ? "" : "s"}
                      </Badge>
                      {row.reused ? <Badge tone="approved">Reused</Badge> : null}
                      {row.suggestionAssisted ? <Badge tone="draft">Suggestion-assisted</Badge> : null}
                    </div>
                  </div>
                  <div className="toolbar-row compact">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setPreviewApprovedAnswerId(row.approvedAnswerId);
                        setPreviewErrorMessage("");
                      }}
                      disabled={Boolean(applyingApprovedAnswerId)}
                    >
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleApplyApprovedAnswer(row.approvedAnswerId)}
                      disabled={Boolean(applyingApprovedAnswerId)}
                      aria-label={`Apply approved answer with ${row.snapshottedCitationsCount} citations`}
                    >
                      {applyingApprovedAnswerId === row.approvedAnswerId ? "Applying..." : "Apply"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
