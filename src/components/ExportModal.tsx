"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, cx } from "@/components/ui";

export type ExportMode = "preferApproved" | "approvedOnly" | "generated";

type ExportModalProps = {
  isOpen: boolean;
  questionnaireId: string | null;
  questionnaireName: string;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
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

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        return payload.error;
      }
    } else {
      const text = (await response.text()).trim();
      if (text.length > 0) {
        return text;
      }
    }
  } catch {
    // Fallback message below.
  }

  return "Failed to export questionnaire.";
}

export function ExportModal({
  isOpen,
  questionnaireId,
  questionnaireName,
  onClose,
  onSuccess,
  onError
}: ExportModalProps) {
  const [mode, setMode] = useState<ExportMode>("preferApproved");
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode("preferApproved");
    setErrorMessage("");
    setIsExporting(false);
  }, [isOpen, questionnaireId]);

  const fileName = useMemo(
    () => buildDownloadFileName(questionnaireName || "questionnaire"),
    [questionnaireName]
  );

  async function handleExport() {
    if (!questionnaireId) {
      setErrorMessage("Questionnaire ID is missing.");
      return;
    }

    setIsExporting(true);
    setErrorMessage("");

    try {
      const url = new URL(`/api/questionnaires/${questionnaireId}/export`, window.location.origin);
      url.searchParams.set("mode", mode);

      const response = await fetch(url.toString(), {
        method: "GET"
      });

      if (!response.ok) {
        throw new Error(await extractErrorMessage(response));
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
      <div className="overlay-modal-card export-modal-card">
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
              />
              <span>
                <span className="export-mode-title">{option.label}</span>
                <span className="small muted export-mode-description">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        <p className="small muted export-file-hint">Filename: {fileName}</p>
        {errorMessage ? <div className="message-banner error">{errorMessage}</div> : null}

        <div className="toolbar-row" style={{ marginTop: 12 }}>
          <Button type="button" variant="primary" onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Exporting...
              </>
            ) : (
              "Download CSV"
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
