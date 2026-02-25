"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, TextInput, cx } from "@/components/ui";

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
  error?: string;
};

function getMessageTone(message: string): "approved" | "review" | "notfound" {
  const normalized = message.toLowerCase();
  if (normalized.includes("failed") || normalized.includes("error")) {
    return "notfound";
  }

  if (normalized.includes("imported") || normalized.includes("complete") || normalized.includes("deleted")) {
    return "approved";
  }

  return "review";
}

export default function QuestionnairesPage() {
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

  const previewHeaders = useMemo(() => headers, [headers]);

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
    setActiveAutofillId(questionnaireId);
    setMessage("");

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      });

      const payload = (await response.json()) as AutofillResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Autofill failed");
      }

      setMessage(
        `Autofill complete: ${payload.answeredCount}/${payload.totalCount} answered, ${payload.notFoundCount} not found.`
      );
      await fetchQuestionnaires();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Autofill failed");
    } finally {
      setActiveAutofillId(null);
    }
  }

  async function deleteQuestionnaire(questionnaireId: string) {
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

  return (
    <div className="page-stack">
      <Card id="import">
        <div className="card-title-row">
          <div>
            <h2 style={{ marginBottom: 4 }}>Import Questionnaire</h2>
            <p className="muted" style={{ margin: 0 }}>
              Upload CSV, pick the question column, and create a new review run.
            </p>
          </div>
          <Badge tone="draft" title="CSV only">
            CSV workflow
          </Badge>
        </div>

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
                disabled={headers.length === 0}
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
              />
            </div>
          </div>

          <div className="toolbar-row">
            <Button type="submit" variant="primary" disabled={isParsing || isImporting || !selectedFile}>
              {isImporting ? "Importing..." : "Create Questionnaire"}
            </Button>
            <Button type="button" variant="secondary" disabled={isLoadingList} onClick={() => void fetchQuestionnaires()}>
              Refresh list
            </Button>
          </div>
        </form>
      </Card>

      {message ? (
        <Card className="card-muted">
          <Badge tone={getMessageTone(message)}>{message}</Badge>
        </Card>
      ) : null}

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
          {isLoadingList ? <Badge tone="review">Loading...</Badge> : null}
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
            <table className="data-table">
              <thead>
                <tr>
                  <th>Questionnaire</th>
                  <th>Source</th>
                  <th>Questions</th>
                  <th>Answered</th>
                  <th>Not found</th>
                  <th>Last updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {questionnaires.map((questionnaire) => (
                  <tr key={questionnaire.id}>
                    <td>
                      <strong>{questionnaire.name}</strong>
                    </td>
                    <td className="muted">{questionnaire.sourceFileName ?? "n/a"}</td>
                    <td>{questionnaire.questionCount}</td>
                    <td>{questionnaire.answeredCount}</td>
                    <td>
                      <span className={cx("badge", questionnaire.notFoundCount > 0 ? "status-notfound" : "status-approved")}>
                        {questionnaire.notFoundCount}
                      </span>
                    </td>
                    <td className="muted">{new Date(questionnaire.updatedAt || questionnaire.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="toolbar-row">
                        <Link href={`/questionnaires/${questionnaire.id}`} className="btn btn-primary">
                          Open
                        </Link>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void runAutofill(questionnaire.id)}
                          disabled={activeAutofillId === questionnaire.id || activeDeleteId === questionnaire.id}
                        >
                          {activeAutofillId === questionnaire.id ? "Running..." : "Run Autofill"}
                        </Button>
                        <a className="btn btn-ghost" href={`/api/questionnaires/${questionnaire.id}/export`}>
                          Export
                        </a>
                        <a className="btn btn-ghost" href={`/api/questionnaires/${questionnaire.id}/export?mode=approvedOnly`}>
                          Approved only
                        </a>
                        <a className="btn btn-ghost" href={`/api/questionnaires/${questionnaire.id}/export?mode=generated`}>
                          Generated only
                        </a>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => void deleteQuestionnaire(questionnaire.id)}
                          disabled={activeAutofillId === questionnaire.id || activeDeleteId === questionnaire.id}
                        >
                          {activeDeleteId === questionnaire.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
