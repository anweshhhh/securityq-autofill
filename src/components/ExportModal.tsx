"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  buildExportBlockedMessage,
  parseExportBlockedError,
  type ExportBlockedStaleError
} from "@/shared/exportErrors";
import { Button, cx } from "@/components/ui";

export type ExportMode = "preferApproved" | "approvedOnly" | "generated";

type ExportModalProps = {
  isOpen: boolean;
  questionnaireId: string | null;
  questionnaireName: string;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
  loadApprovedOnlyPreflight?: () => Promise<ExportBlockedStaleError | null>;
  onReviewStale?: (details: ExportBlockedStaleError | null) => void | Promise<void>;
};

const MODE_OPTIONS: Array<{ value: ExportMode; label: string; description: string }> = [
  {
    value: "preferApproved",
    label: "Prefer approved",
    description: "Use approved answers when available; otherwise use generated answers."
  },
  {
    value: "approvedOnly",
    label: "Approved only",
    description: "Export only approved answers; non-approved rows are blank."
  },
  {
    value: "generated",
    label: "Generated only",
    description: "Ignore approved overrides and export generated answers only."
  }
];

function sanitizeFileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "questionnaire";
}

function buildDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDownloadFileName(questionnaireName: string, date = new Date()): string {
  return `${sanitizeFileName(questionnaireName)}-${buildDateStamp(date)}-export.csv`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readExportFailure(response: Response): Promise<{
  message: string;
  blocked: ExportBlockedStaleError | null;
}> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: unknown };
      const blocked = parseExportBlockedError(response.status, payload);
      if (blocked) {
        return {
          message: buildExportBlockedMessage(blocked.staleCount),
          blocked
        };
      }

      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        return {
          message: payload.error,
          blocked: null
        };
      }

      if (isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim().length > 0) {
        return {
          message: payload.error.message,
          blocked: null
        };
      }
    } else {
      const text = (await response.text()).trim();
      if (text.length > 0) {
        return {
          message: text,
          blocked: null
        };
      }
    }
  } catch {
    // Fallback message below.
  }

  return {
    message: "Failed to export questionnaire.",
    blocked: null
  };
}

export function ExportModal({
  isOpen,
  questionnaireId,
  questionnaireName,
  onClose,
  onSuccess,
  onError,
  loadApprovedOnlyPreflight,
  onReviewStale
}: ExportModalProps) {
  const [mode, setMode] = useState<ExportMode>("preferApproved");
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingApprovedOnly, setIsCheckingApprovedOnly] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [approvedOnlyPreflight, setApprovedOnlyPreflight] = useState<ExportBlockedStaleError | null>(null);
  const [blockedExport, setBlockedExport] = useState<ExportBlockedStaleError | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode("preferApproved");
    setErrorMessage("");
    setIsExporting(false);
    setIsCheckingApprovedOnly(false);
    setApprovedOnlyPreflight(null);
    setBlockedExport(null);
  }, [isOpen, questionnaireId]);

  useEffect(() => {
    if (mode !== "approvedOnly") {
      setBlockedExport(null);
    }
  }, [mode]);

  useEffect(() => {
    if (!isOpen || !questionnaireId || !loadApprovedOnlyPreflight) {
      setIsCheckingApprovedOnly(false);
      setApprovedOnlyPreflight(null);
      return;
    }

    let cancelled = false;
    setIsCheckingApprovedOnly(true);

    void loadApprovedOnlyPreflight()
      .then((details) => {
        if (cancelled) {
          return;
        }
        setApprovedOnlyPreflight(details && details.staleCount > 0 ? details : null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setApprovedOnlyPreflight(null);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsCheckingApprovedOnly(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, questionnaireId, loadApprovedOnlyPreflight]);

  const fileName = useMemo(
    () => buildDownloadFileName(questionnaireName || "questionnaire"),
    [questionnaireName]
  );
  const activeBlockedInfo = mode === "approvedOnly" ? blockedExport ?? approvedOnlyPreflight : null;
  const approvedOnlyExportBlocked = Boolean(activeBlockedInfo?.staleCount);

  useFocusTrap({
    active: isOpen && Boolean(questionnaireId),
    containerRef: modalRef,
    onEscape: () => {
      if (!isExporting) {
        onClose();
      }
    }
  });

  async function handleReviewStale() {
    if (!onReviewStale) {
      return;
    }

    onClose();
    await onReviewStale(activeBlockedInfo ?? approvedOnlyPreflight ?? null);
  }

  async function handleExport() {
    if (!questionnaireId) {
      setErrorMessage("Questionnaire ID is missing.");
      return;
    }

    if (mode === "approvedOnly" && approvedOnlyPreflight?.staleCount) {
      setBlockedExport(approvedOnlyPreflight);
      setErrorMessage("");
      return;
    }

    setIsExporting(true);
    setErrorMessage("");
    setBlockedExport(null);

    try {
      const url = new URL(`/api/questionnaires/${questionnaireId}/export`, window.location.origin);
      url.searchParams.set("mode", mode);

      const response = await fetch(url.toString(), {
        method: "GET"
      });

      if (!response.ok) {
        const failure = await readExportFailure(response);
        if (failure.blocked) {
          setBlockedExport(failure.blocked);
          return;
        }

        throw new Error(failure.message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      onSuccess?.(`Export complete: ${fileName}`);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export questionnaire.";
      setErrorMessage(message);
      onError?.(`Export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  }

  if (!isOpen || !questionnaireId) {
    return null;
  }

  return (
    <div className="overlay-modal" role="dialog" aria-modal="true" aria-label="Export questionnaire">
      <div className="overlay-modal-card export-modal-card" ref={modalRef} tabIndex={-1}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>Export Questionnaire</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Choose export mode and download a CSV snapshot.
        </p>

        <div className="export-mode-list">
          {MODE_OPTIONS.map((option) => (
            <label key={option.value} className={cx("export-mode-option", mode === option.value && "active")}>
              <input
                type="radio"
                name="export-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                disabled={isExporting}
                aria-label={`Export mode ${option.label}`}
              />
              <span>
                <span className="export-mode-title">{option.label}</span>
                <span className="small muted export-mode-description">{option.description}</span>
                {option.value === "approvedOnly" && approvedOnlyPreflight?.staleCount ? (
                  <span className="small" style={{ color: "#7f1d1d", display: "block", marginTop: 4 }}>
                    {`Blocked: ${approvedOnlyPreflight.staleCount} stale approval${
                      approvedOnlyPreflight.staleCount === 1 ? "" : "s"
                    }`}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>

        {mode === "approvedOnly" && isCheckingApprovedOnly ? (
          <div className="message-banner" role="status" aria-live="polite" style={{ marginTop: 12 }}>
            Checking stale approvals...
          </div>
        ) : null}

        {mode === "approvedOnly" && activeBlockedInfo ? (
          <div className="message-banner error" role="status" aria-live="polite" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Export blocked</div>
            <div>{buildExportBlockedMessage(activeBlockedInfo.staleCount)}</div>
            {onReviewStale ? (
              <div className="toolbar-row compact" style={{ marginTop: 10 }}>
                <Button type="button" variant="secondary" onClick={() => void handleReviewStale()}>
                  Review stale
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="small muted export-file-hint">Filename: {fileName}</p>
        {errorMessage ? <div className="message-banner error">{errorMessage}</div> : null}

        <div className="toolbar-row" style={{ marginTop: 12 }}>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleExport()}
            disabled={isExporting || (mode === "approvedOnly" && (isCheckingApprovedOnly || approvedOnlyExportBlocked))}
          >
            {isExporting ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Exporting...
              </>
            ) : (
              "Download CSV"
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isExporting} aria-label="Cancel export">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
