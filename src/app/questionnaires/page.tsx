"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type PreviewRow = Record<string, string>;

type QuestionnaireRow = {
  id: string;
  name: string;
  createdAt: string;
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
      setMessage("Select a CSV file first");
      return;
    }

    if (!questionColumn) {
      setMessage("Select the question column");
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
        `Imported ${payload.questionnaire?.name ?? "questionnaire"} (${payload.questionnaire?.questionCount ?? 0} questions)`
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
    <main>
      <p>
        <Link href="/">Back to Home</Link>
      </p>

      <h1>Questionnaires</h1>

      <form onSubmit={handleImport}>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            void handleFileSelect(file);
          }}
        />

        <div>
          <label>
            Question column
            <select
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
          </label>
        </div>

        <div>
          <label>
            Questionnaire name (optional)
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>

        <button type="submit" disabled={isParsing || isImporting || !selectedFile}>
          {isImporting ? "Importing..." : "Create Questionnaire"}
        </button>
      </form>

      {message ? <p>{message}</p> : null}

      {previewRows.length > 0 ? (
        <section>
          <h2>Preview (first {previewRows.length} rows)</h2>
          <table>
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
        </section>
      ) : null}

      <h2>Saved Questionnaires</h2>
      {isLoadingList ? <p>Loading...</p> : null}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Questions</th>
            <th>Answered</th>
            <th>Not Found</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {questionnaires.length === 0 ? (
            <tr>
              <td colSpan={6}>No questionnaires yet.</td>
            </tr>
          ) : (
            questionnaires.map((questionnaire) => (
              <tr key={questionnaire.id}>
                <td>{questionnaire.name}</td>
                <td>{questionnaire.questionCount}</td>
                <td>{questionnaire.answeredCount}</td>
                <td>{questionnaire.notFoundCount}</td>
                <td>{new Date(questionnaire.createdAt).toLocaleString()}</td>
                <td>
                  <Link href={`/questionnaires/${questionnaire.id}`}>View</Link>{" "}
                  <button
                    type="button"
                    onClick={() => void runAutofill(questionnaire.id)}
                    disabled={activeAutofillId === questionnaire.id || activeDeleteId === questionnaire.id}
                  >
                    {activeAutofillId === questionnaire.id ? "Running..." : "Run Autofill"}
                  </button>{" "}
                  <a href={`/api/questionnaires/${questionnaire.id}/export`}>Download CSV</a>{" "}
                  <button
                    type="button"
                    onClick={() => void deleteQuestionnaire(questionnaire.id)}
                    disabled={activeAutofillId === questionnaire.id || activeDeleteId === questionnaire.id}
                  >
                    {activeDeleteId === questionnaire.id ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </main>
  );
}
