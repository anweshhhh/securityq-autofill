"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuthz } from "@/components/AppAuthzContext";
import { CollapsibleInputSection } from "@/components/CollapsibleInputSection";
import { ExportModal } from "@/components/ExportModal";
import { Badge, Button, Card, TextInput, cx } from "@/components/ui";
import { can, RbacAction } from "@/server/rbac";

type PreviewRow = Record<string, string>;

type QuestionnaireRow = {
  id: string;
  name: string;
  sourceFileName: string | null;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  answeredCount: number;
  notFoundCount: number;
};

type AutofillResult = {
  questionnaireId: string;
  totalCount: number;
  answeredCount: number;
  foundCount: number;
  notFoundCount: number;
  error?: unknown;
};

type EmbedResult = {
  embeddedCount?: number;
  error?: unknown;
};

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const typed = payload as { error?: unknown };
  if (typeof typed.error === "string" && typed.error.trim()) {
    return typed.error.trim();
  }

  if (typed.error && typeof typed.error === "object" && !Array.isArray(typed.error)) {
    const nested = typed.error as { message?: unknown };
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
  }

  return fallback;
}

function getMessageTone(message: string): "approved" | "review" | "notfound" {
  const normalized = message.toLowerCase();
  if (normalized.includes("failed") || normalized.includes("error")) {
    return "notfound";
  }

  if (
    normalized.includes("imported") ||
    normalized.includes("complete") ||
    normalized.includes("deleted") ||
    normalized.includes("export")
  ) {
    return "approved";
  }

  return "review";
}

export default function QuestionnairesPage() {
  const router = useRouter();
  const { role } = useAppAuthz();
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [questionColumn, setQuestionColumn] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeAutofillId, setActiveAutofillId] = useState<string | null>(null);
  const [activeDeleteId, setActiveDeleteId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [exportTarget, setExportTarget] = useState<{ id: string; name: string } | null>(null);
  const [isImportSectionExpanded, setIsImportSectionExpanded] = useState(true);
  const importCollapseInitializedRef = useRef(false);

  const previewHeaders = useMemo(() => headers, [headers]);
  const canImportQuestionnaires = role ? can(role, RbacAction.IMPORT_QUESTIONNAIRES) : false;
  const canRunAutofill = role ? can(role, RbacAction.RUN_AUTOFILL) : false;
  const canDeleteQuestionnaires = role ? can(role, RbacAction.DELETE_QUESTIONNAIRES) : false;
  const canExportQuestionnaires = role ? can(role, RbacAction.EXPORT) : false;

  const filteredQuestionnaires = useMemo(() => {
    const lowered = searchText.trim().toLowerCase();
    if (!lowered) {
      return questionnaires;
    }

    return questionnaires.filter((questionnaire) => {
      return (
        questionnaire.name.toLowerCase().includes(lowered) ||
        (questionnaire.sourceFileName ?? "").toLowerCase().includes(lowered)
      );
    });
  }, [questionnaires, searchText]);

  const questionnaireSummary = useMemo(() => {
    const totalQuestionnaires = questionnaires.length;
    const totalQuestions = questionnaires.reduce((sum, row) => sum + row.questionCount, 0);
    const totalAnswered = questionnaires.reduce((sum, row) => sum + row.answeredCount, 0);
    const totalNotFound = questionnaires.reduce((sum, row) => sum + row.notFoundCount, 0);

    return {
      totalQuestionnaires,
      totalQuestions,
      totalAnswered,
      totalNotFound
    };
  }, [questionnaires]);

  async function fetchQuestionnaires() {
    setIsLoadingList(true);

    try {
      const response = await fetch("/api/questionnaires", { cache: "no-store" });
      const payload = (await response.json()) as {
        questionnaires?: QuestionnaireRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load questionnaires");
      }

      setQuestionnaires(payload.questionnaires ?? []);
      if (!importCollapseInitializedRef.current) {
        setIsImportSectionExpanded((payload.questionnaires ?? []).length === 0);
        importCollapseInitializedRef.current = true;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load questionnaires");
    } finally {
      setIsLoadingList(false);
    }
  }

  useEffect(() => {
    void fetchQuestionnaires();
  }, []);

  async function handleFileSelect(file: File | null) {
    if (!canImportQuestionnaires) {
      setMessage("You do not have permission to import questionnaires.");
      return;
    }

    setSelectedFile(file);
    setHeaders([]);
    setPreviewRows([]);
    setQuestionColumn("");
    setMessage("");

    if (!file) {
      return;
    }

    setIsParsing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/questionnaires/headers", {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as {
        headers?: string[];
        rowCount?: number;
        previewRows?: PreviewRow[];
        suggestedQuestionColumn?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to parse CSV");
      }

      setHeaders(payload.headers ?? []);
      setPreviewRows(payload.previewRows ?? []);
      setQuestionColumn(payload.suggestedQuestionColumn ?? payload.headers?.[0] ?? "");
      setMessage(`Parsed ${payload.rowCount ?? 0} rows`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to parse CSV");
    } finally {
      setIsParsing(false);
    }
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canImportQuestionnaires) {
      setMessage("You do not have permission to import questionnaires.");
      return;
    }

    if (!selectedFile) {
      setMessage("Select a CSV file first.");
      return;
    }

    if (!questionColumn) {
      setMessage("Select the question column.");
      return;
    }

    setIsImporting(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("questionColumn", questionColumn);
      formData.append("name", name);

      const response = await fetch("/api/questionnaires/import", {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as {
        questionnaire?: { name: string; questionCount: number };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Import failed");
      }

      setMessage(
        `Imported ${payload.questionnaire?.name ?? "questionnaire"} (${payload.questionnaire?.questionCount ?? 0} questions).`
      );
      setSelectedFile(null);
      setHeaders([]);
      setPreviewRows([]);
      setQuestionColumn("");
      setName("");

      await fetchQuestionnaires();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setIsImporting(false);
    }
  }

  async function runAutofill(questionnaireId: string) {
    if (!canRunAutofill) {
      setMessage("You do not have permission to run autofill.");
      return;
    }

    setActiveAutofillId(questionnaireId);
    setMessage("");

    try {
      const embedResponse = await fetch("/api/documents/embed", {
        method: "POST"
      });
      const embedPayload = (await embedResponse.json().catch(() => ({}))) as EmbedResult;
      if (!embedResponse.ok) {
        throw new Error(
          `Embedding step failed: ${getApiErrorMessage(embedPayload, "Failed to embed document chunks.")}`
        );
      }

      const response = await fetch(`/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      });

      const payload = (await response.json()) as AutofillResult;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Autofill failed"));
      }

      const embeddedCount = Number(embedPayload.embeddedCount ?? 0);
      const embeddingPrefix =
        embeddedCount > 0 ? `Embedded ${embeddedCount} pending chunk${embeddedCount === 1 ? "" : "s"}. ` : "";
      setMessage(
        `${embeddingPrefix}Autofill complete: ${payload.answeredCount}/${payload.totalCount} answered, ${payload.notFoundCount} not found.`
      );
      await fetchQuestionnaires();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Autofill failed");
    } finally {
      setActiveAutofillId(null);
    }
  }

  async function deleteQuestionnaire(questionnaireId: string) {
    if (!canDeleteQuestionnaires) {
      setMessage("You do not have permission to delete questionnaires.");
      return;
    }

    if (!window.confirm("Delete this questionnaire?")) {
      return;
    }

    setActiveDeleteId(questionnaireId);
    setMessage("");

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Delete failed");
      }

      setMessage("Questionnaire deleted.");
      await fetchQuestionnaires();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setActiveDeleteId(null);
    }
  }

  function openQuestionnaire(questionnaireId: string) {
    try {
      window.localStorage.setItem("lastQuestionnaireId", questionnaireId);
    } catch {
      // Navigation should still proceed even if localStorage is unavailable.
    }

    router.push(`/questionnaires/${questionnaireId}`);
  }

  return (
    <div className="page-stack">
      <CollapsibleInputSection
        id="import"
        title="Import Questionnaire"
        helperText="Upload CSV, pick the question column, and create a new review run."
        expanded={isImportSectionExpanded}
        onToggle={() => setIsImportSectionExpanded((value) => !value)}
        badgeLabel="CSV workflow"
        badgeTone="draft"
        badgeTitle="CSV only"
      >
        <form onSubmit={handleImport} className="page-stack">
          <div className="two-col">
            <div className="card card-muted">
              <label className="small muted" htmlFor="questionnaire-file">
                CSV file
              </label>
              <input
                id="questionnaire-file"
                className="input"
                type="file"
                accept=".csv,text/csv"
                disabled={!canImportQuestionnaires}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleFileSelect(file);
                }}
              />
              <p className="muted small" style={{ marginBottom: 0 }}>
                We auto-suggest a question column after parsing.
              </p>
            </div>

            <div className="card card-muted">
              <label className="small muted" htmlFor="question-column">
                Question column
              </label>
              <select
                id="question-column"
                className="select"
                value={questionColumn}
                onChange={(event) => setQuestionColumn(event.target.value)}
                disabled={headers.length === 0 || !canImportQuestionnaires}
              >
                <option value="">Select column</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <label className="small muted" htmlFor="questionnaire-name" style={{ marginTop: 10, display: "block" }}>
                Questionnaire name (optional)
              </label>
              <TextInput
                id="questionnaire-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Quarterly vendor review"
                disabled={!canImportQuestionnaires}
              />
            </div>
          </div>

          <div className="toolbar-row">
            <Button
              type="submit"
              variant="primary"
              disabled={isParsing || isImporting || !selectedFile || !canImportQuestionnaires}
            >
              {isImporting ? "Importing..." : "Create Questionnaire"}
            </Button>
            <Button type="button" variant="secondary" disabled={isLoadingList} onClick={() => void fetchQuestionnaires()}>
              Refresh list
            </Button>
          </div>
        </form>
      </CollapsibleInputSection>

      {message ? (
        <div
          className={cx(
            "message-banner",
            getMessageTone(message) === "notfound"
              ? "error"
              : getMessageTone(message) === "approved"
                ? "success"
                : ""
          )}
        >
          {message}
        </div>
      ) : null}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Questionnaires</div>
          <div className="value">{questionnaireSummary.totalQuestionnaires}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Questions total</div>
          <div className="value">{questionnaireSummary.totalQuestions}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Answered</div>
          <div className="value">{questionnaireSummary.totalAnswered}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Not found</div>
          <div className="value">{questionnaireSummary.totalNotFound}</div>
        </div>
      </div>

      {previewRows.length > 0 ? (
        <Card>
          <div className="card-title-row">
            <h3 style={{ margin: 0 }}>Preview ({previewRows.length} rows)</h3>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {previewHeaders.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={`preview-${rowIndex}`}>
                    {previewHeaders.map((header) => (
                      <td key={`${rowIndex}-${header}`}>{row[header]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="card-title-row">
          <div>
            <h2 style={{ marginBottom: 4 }}>Saved Questionnaires</h2>
            <p className="muted" style={{ margin: 0 }}>
              Open for review, rerun autofill, and export.
            </p>
          </div>
          <div className="toolbar-row compact">
            <div className="search-field">
              <label className="search-field-label" htmlFor="saved-questionnaire-search">
                Search
              </label>
              <TextInput
                id="saved-questionnaire-search"
                className="search-field-input"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Name or source file"
                title="Filter questionnaire list"
              />
              {searchText.trim().length > 0 ? (
                <button
                  type="button"
                  className="search-field-clear"
                  onClick={() => setSearchText("")}
                  aria-label="Clear questionnaire search"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {isLoadingList ? <Badge tone="review">Loading...</Badge> : null}
          </div>
        </div>

        {questionnaires.length === 0 ? (
          <div className="empty-state">
            <h3 style={{ marginTop: 0 }}>No questionnaires yet</h3>
            <p>Import your first CSV questionnaire to start the autofill and review workflow.</p>
            <Link href="#import" className="btn btn-primary">
              Import Questionnaire
            </Link>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table questionnaires-table">
              <thead>
                <tr>
                  <th>Questionnaire</th>
                  <th>Source</th>
                  <th>Questions</th>
                  <th>Completion</th>
                  <th>Answered</th>
                  <th>Not found</th>
                  <th>Last updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuestionnaires.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No questionnaires match the current search.</td>
                  </tr>
                ) : null}

                {filteredQuestionnaires.map((questionnaire) => (
                  <tr key={questionnaire.id}>
                    <td>
                      <strong>{questionnaire.name}</strong>
                    </td>
                    <td className="muted questionnaire-source" title={questionnaire.sourceFileName ?? "n/a"}>
                      {questionnaire.sourceFileName ?? "n/a"}
                    </td>
                    <td>{questionnaire.questionCount}</td>
                    <td>
                      {questionnaire.questionCount > 0
                        ? `${Math.round((questionnaire.answeredCount / questionnaire.questionCount) * 100)}%`
                        : "0%"}
                    </td>
                    <td>{questionnaire.answeredCount}</td>
                    <td>
                      <span className={cx("badge", questionnaire.notFoundCount > 0 ? "status-notfound" : "status-approved")}>
                        {questionnaire.notFoundCount}
                      </span>
                    </td>
                    <td className="muted">{new Date(questionnaire.updatedAt || questionnaire.createdAt).toLocaleString()}</td>
                    <td className="questionnaire-actions-cell">
                      <div className="questionnaire-action-stack">
                        <div className="table-actions">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => openQuestionnaire(questionnaire.id)}
                            aria-label={`Open questionnaire ${questionnaire.name}`}
                          >
                            Open
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void runAutofill(questionnaire.id)}
                            disabled={
                              activeAutofillId === questionnaire.id ||
                              activeDeleteId === questionnaire.id ||
                              !canRunAutofill
                            }
                          >
                            {activeAutofillId === questionnaire.id ? "Running..." : "Run Autofill"}
                          </Button>
                        </div>
                        <details className="row-actions-menu">
                          <summary className="btn btn-ghost row-actions-trigger" aria-label="Open more actions menu">
                            More
                          </summary>
                          <div className="row-actions-dropdown">
                            <button
                              type="button"
                              className="row-actions-item"
                              onClick={() => setExportTarget({ id: questionnaire.id, name: questionnaire.name })}
                              disabled={
                                activeAutofillId === questionnaire.id ||
                                activeDeleteId === questionnaire.id ||
                                !canExportQuestionnaires
                              }
                              aria-label={`Export questionnaire ${questionnaire.name}`}
                            >
                              Export...
                            </button>
                            {canDeleteQuestionnaires ? (
                              <button
                                type="button"
                                className="row-actions-item danger"
                                onClick={() => void deleteQuestionnaire(questionnaire.id)}
                                disabled={activeAutofillId === questionnaire.id || activeDeleteId === questionnaire.id}
                                aria-label={`Delete questionnaire ${questionnaire.name}`}
                              >
                                {activeDeleteId === questionnaire.id ? "Deleting..." : "Delete questionnaire"}
                              </button>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ExportModal
        isOpen={Boolean(exportTarget) && canExportQuestionnaires}
        questionnaireId={exportTarget?.id ?? null}
        questionnaireName={exportTarget?.name ?? "questionnaire"}
        onClose={() => setExportTarget(null)}
        onSuccess={(nextMessage) => setMessage(nextMessage)}
        onError={(nextMessage) => setMessage(nextMessage)}
      />
    </div>
  );
}
