"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type QuestionnaireRow = {
  id: string;
  name: string;
  createdAt: string;
  questionCount: number;
  answeredCount: number;
};

export default function QuestionnairesPage() {
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [questionColumn, setQuestionColumn] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [autofillId, setAutofillId] = useState<string | null>(null);

  async function fetchQuestionnaires() {
    setIsLoadingList(true);

    try {
      const response = await fetch("/api/questionnaires", { cache: "no-store" });
      const payload = (await response.json()) as {
        questionnaires: QuestionnaireRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load questionnaires");
      }

      setQuestionnaires(payload.questionnaires);
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
        suggestedQuestionColumn?: string;
        rowCount?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to parse CSV headers");
      }

      setHeaders(payload.headers ?? []);
      setQuestionColumn(payload.suggestedQuestionColumn ?? payload.headers?.[0] ?? "");
      setMessage(`Parsed ${payload.rowCount ?? 0} rows`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to parse CSV headers");
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
      setMessage("Select a question column");
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
        throw new Error(payload.error ?? "Failed to import questionnaire");
      }

      setMessage(
        `Imported ${payload.questionnaire?.name ?? "questionnaire"} (${payload.questionnaire?.questionCount ?? 0} questions)`
      );
      setSelectedFile(null);
      setHeaders([]);
      setQuestionColumn("");
      setName("");

      await fetchQuestionnaires();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to import questionnaire");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleAutofill(questionnaireId: string) {
    setAutofillId(questionnaireId);
    setMessage("");

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      });

      const payload = (await response.json()) as {
        completedCount?: number;
        notFoundCount?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to autofill questionnaire");
      }

      setMessage(
        `Autofill complete: ${payload.completedCount ?? 0} questions processed, ${payload.notFoundCount ?? 0} not found`
      );

      await fetchQuestionnaires();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to autofill questionnaire");
    } finally {
      setAutofillId(null);
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
          {isImporting ? "Importing..." : "Import CSV"}
        </button>
      </form>

      {message ? <p>{message}</p> : null}

      <h2>Saved Questionnaires</h2>
      {isLoadingList ? <p>Loading...</p> : null}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Created</th>
            <th>Questions</th>
            <th>Answered</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {questionnaires.length === 0 ? (
            <tr>
              <td colSpan={5}>No questionnaires yet.</td>
            </tr>
          ) : (
            questionnaires.map((questionnaire) => (
              <tr key={questionnaire.id}>
                <td>{questionnaire.name}</td>
                <td>{new Date(questionnaire.createdAt).toLocaleString()}</td>
                <td>{questionnaire.questionCount}</td>
                <td>{questionnaire.answeredCount}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => void handleAutofill(questionnaire.id)}
                    disabled={autofillId === questionnaire.id}
                  >
                    {autofillId === questionnaire.id ? "Autofilling..." : "Autofill"}
                  </button>{" "}
                  <a href={`/api/questionnaires/${questionnaire.id}/export`}>Download CSV</a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </main>
  );
}
