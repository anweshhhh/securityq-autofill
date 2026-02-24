"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Citation = {
  docName: string;
  chunkId: string;
  quotedSnippet: string;
};

type QuestionRow = {
  id: string;
  rowIndex: number;
  text: string;
  answer: string | null;
  citations: Citation[];
};

type QuestionnaireDetailsPayload = {
  questionnaire: {
    id: string;
    name: string;
    sourceFileName: string | null;
    questionColumn: string | null;
    questionCount: number;
    answeredCount: number;
    notFoundCount: number;
    createdAt: string;
    updatedAt: string;
  };
  questions: QuestionRow[];
  error?: string;
};

type QuestionFilter = "ALL" | "ANSWERED" | "NOT_FOUND";

const NOT_FOUND_ANSWER = "Not found in provided documents.";

function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const typed = item as Partial<Citation>;
      if (!typed.docName || !typed.chunkId || !typed.quotedSnippet) {
        return null;
      }

      return {
        docName: String(typed.docName),
        chunkId: String(typed.chunkId),
        quotedSnippet: String(typed.quotedSnippet)
      };
    })
    .filter((item): item is Citation => item !== null);
}

export default function QuestionnaireDetailsPage() {
  const params = useParams<{ id: string }>();
  const questionnaireId = params.id;

  const [data, setData] = useState<QuestionnaireDetailsPayload | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<QuestionFilter>("ALL");

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as QuestionnaireDetailsPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load questionnaire");
      }

      setData({
        questionnaire: payload.questionnaire,
        questions: (payload.questions ?? []).map((question) => ({
          ...question,
          citations: normalizeCitations(question.citations)
        }))
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load questionnaire");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [questionnaireId]);

  useEffect(() => {
    if (questionnaireId) {
      void loadDetails();
    }
  }, [questionnaireId, loadDetails]);

  const filteredQuestions = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.questions.filter((question) => {
      const answered = Boolean(question.answer);
      const notFound = question.answer === NOT_FOUND_ANSWER;

      if (filter === "ANSWERED") {
        return answered;
      }

      if (filter === "NOT_FOUND") {
        return notFound;
      }

      return true;
    });
  }, [data, filter]);

  return (
    <main>
      <p>
        <Link href="/questionnaires">Back to Questionnaires</Link>
      </p>

      <h1>Questionnaire Details</h1>

      <button type="button" onClick={() => void loadDetails()} disabled={isLoading}>
        {isLoading ? "Refreshing..." : "Refresh"}
      </button>

      {message ? <p>{message}</p> : null}
      {isLoading && !data ? <p>Loading...</p> : null}

      {data ? (
        <>
          <section>
            <h2>{data.questionnaire.name}</h2>
            <p>
              Questions: {data.questionnaire.questionCount} | Answered: {data.questionnaire.answeredCount} | Not
              Found: {data.questionnaire.notFoundCount}
            </p>
            <p>Source: {data.questionnaire.sourceFileName ?? "n/a"}</p>
            <p>Question column: {data.questionnaire.questionColumn ?? "n/a"}</p>
          </section>

          <section>
            <p>Filter:</p>
            <button type="button" onClick={() => setFilter("ALL")} disabled={filter === "ALL"}>
              All
            </button>{" "}
            <button
              type="button"
              onClick={() => setFilter("ANSWERED")}
              disabled={filter === "ANSWERED"}
            >
              Answered
            </button>{" "}
            <button
              type="button"
              onClick={() => setFilter("NOT_FOUND")}
              disabled={filter === "NOT_FOUND"}
            >
              Not Found
            </button>
          </section>

          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Citations</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={4}>No questions for the selected filter.</td>
                </tr>
              ) : (
                filteredQuestions.map((question) => (
                  <tr key={question.id}>
                    <td>{question.rowIndex}</td>
                    <td>{question.text || "n/a"}</td>
                    <td>{question.answer ?? "Not answered yet"}</td>
                    <td>
                      {question.citations.length === 0 ? (
                        "none"
                      ) : (
                        <details>
                          <summary>{question.citations.length} citation(s)</summary>
                          <table>
                            <tbody>
                              {question.citations.map((citation, index) => (
                                <tr key={`${question.id}-citation-${index}`}>
                                  <td>
                                    {citation.docName}#{citation.chunkId}: &quot;{citation.quotedSnippet}&quot;
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
