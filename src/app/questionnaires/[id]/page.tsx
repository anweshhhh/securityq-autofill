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
  category: string;
  answer: string | null;
  citations: Citation[];
  confidence: string | null;
  needsReview: boolean | null;
  notFoundReason: string | null;
};

type QuestionnaireDetailsPayload = {
  questionnaire: {
    id: string;
    name: string;
    sourceFileName: string | null;
    questionColumn: string | null;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    totalCount: number;
    processedCount: number;
    foundCount: number;
    notFoundCount: number;
    progressPercent: number;
    createdAt: string;
    updatedAt: string;
  };
  questions: QuestionRow[];
  missingEvidenceReport: Array<{
    category: string;
    count: number;
    recommendation: string;
  }>;
  error?: string;
};

type QuestionFilter = "ALL" | "FOUND" | "NOT_FOUND" | "NEEDS_REVIEW";

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
  const [showMissingReport, setShowMissingReport] = useState(false);

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
        })),
        missingEvidenceReport: payload.missingEvidenceReport ?? []
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
      const hasFoundAnswer = Boolean(question.answer && question.answer !== NOT_FOUND_ANSWER);
      const isNotFound = !question.answer || question.answer === NOT_FOUND_ANSWER;
      const isNeedsReview = question.needsReview === true;

      if (filter === "FOUND") {
        return hasFoundAnswer;
      }

      if (filter === "NOT_FOUND") {
        return isNotFound;
      }

      if (filter === "NEEDS_REVIEW") {
        return isNeedsReview;
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
            <p>Status: {data.questionnaire.status}</p>
            <p>
              Progress: {data.questionnaire.processedCount}/{data.questionnaire.totalCount} (
              {data.questionnaire.progressPercent}%)
            </p>
            <p>
              Found: {data.questionnaire.foundCount} | Not Found: {data.questionnaire.notFoundCount}
            </p>
            <p>Source: {data.questionnaire.sourceFileName ?? "n/a"}</p>
            <p>Question column: {data.questionnaire.questionColumn ?? "n/a"}</p>
          </section>

          <section>
            <p>Filter:</p>
            <button type="button" onClick={() => setFilter("ALL")} disabled={filter === "ALL"}>
              All
            </button>{" "}
            <button type="button" onClick={() => setFilter("FOUND")} disabled={filter === "FOUND"}>
              Found
            </button>{" "}
            <button
              type="button"
              onClick={() => setFilter("NOT_FOUND")}
              disabled={filter === "NOT_FOUND"}
            >
              Not Found
            </button>{" "}
            <button
              type="button"
              onClick={() => setFilter("NEEDS_REVIEW")}
              disabled={filter === "NEEDS_REVIEW"}
            >
              Needs Review
            </button>
          </section>

          <section>
            <button
              type="button"
              onClick={() => setShowMissingReport((current) => !current)}
              disabled={data.missingEvidenceReport.length === 0}
            >
              {showMissingReport ? "Hide Missing Evidence Report" : "Show Missing Evidence Report"}
            </button>
            {showMissingReport ? (
              data.missingEvidenceReport.length === 0 ? (
                <p>No missing evidence report entries.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Not Found Count</th>
                      <th>Recommended Upload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.missingEvidenceReport.map((entry) => (
                      <tr key={entry.category}>
                        <td>{entry.category}</td>
                        <td>{entry.count}</td>
                        <td>{entry.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : null}
          </section>

          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Question</th>
                <th>Category</th>
                <th>Answer</th>
                <th>NotFoundReason</th>
                <th>Confidence</th>
                <th>Needs Review</th>
                <th>Citations</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={8}>No questions for the selected filter.</td>
                </tr>
              ) : (
                filteredQuestions.map((question) => (
                  <tr key={question.id}>
                    <td>{question.rowIndex}</td>
                    <td>{question.text || "n/a"}</td>
                    <td>{question.category || "OTHER"}</td>
                    <td>{question.answer ?? "Not answered yet"}</td>
                    <td>{question.notFoundReason ?? ""}</td>
                    <td>{question.confidence ?? "n/a"}</td>
                    <td>{question.needsReview ? "yes" : "no"}</td>
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
