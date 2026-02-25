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
  reviewStatus: "DRAFT" | "APPROVED" | "NEEDS_REVIEW";
  approvedAnswer: {
    id: string;
    answerText: string;
    citationChunkIds: string[];
    source: "GENERATED" | "MANUAL_EDIT";
    note: string | null;
    updatedAt: string;
  } | null;
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

type QuestionFilter = "ALL" | "DRAFT" | "APPROVED" | "NEEDS_REVIEW";

const NOT_FOUND_ANSWER = "Not found in provided documents.";
const NOT_SPECIFIED_ANSWER = "Not specified in provided documents.";

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

function normalizeApprovedAnswer(value: unknown): QuestionRow["approvedAnswer"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const typed = value as {
    id?: unknown;
    answerText?: unknown;
    citationChunkIds?: unknown;
    source?: unknown;
    note?: unknown;
    updatedAt?: unknown;
  };

  if (typeof typed.id !== "string" || typeof typed.answerText !== "string") {
    return null;
  }

  const citationChunkIds = Array.isArray(typed.citationChunkIds)
    ? typed.citationChunkIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  return {
    id: typed.id,
    answerText: typed.answerText,
    citationChunkIds,
    source: typed.source === "MANUAL_EDIT" ? "MANUAL_EDIT" : "GENERATED",
    note: typeof typed.note === "string" ? typed.note : null,
    updatedAt: typeof typed.updatedAt === "string" ? typed.updatedAt : new Date(0).toISOString()
  };
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const typed = payload as { error?: unknown };
  if (typeof typed.error === "string" && typed.error.trim()) {
    return typed.error;
  }

  if (typed.error && typeof typed.error === "object" && !Array.isArray(typed.error)) {
    const nested = typed.error as { message?: unknown };
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message;
    }
  }

  return fallback;
}

function parseCitationChunkIdsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/g)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

export default function QuestionnaireDetailsPage() {
  const params = useParams<{ id: string }>();
  const questionnaireId = params.id;

  const [data, setData] = useState<QuestionnaireDetailsPayload | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<QuestionFilter>("ALL");
  const [activeQuestionActionId, setActiveQuestionActionId] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editAnswerText, setEditAnswerText] = useState("");
  const [editCitationChunkIdsInput, setEditCitationChunkIdsInput] = useState("");

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as QuestionnaireDetailsPayload;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to load questionnaire"));
      }

      setData({
        questionnaire: payload.questionnaire,
        questions: (payload.questions ?? []).map((question) => ({
          ...question,
          citations: normalizeCitations(question.citations),
          reviewStatus:
            question.reviewStatus === "APPROVED" || question.reviewStatus === "NEEDS_REVIEW"
              ? question.reviewStatus
              : "DRAFT",
          approvedAnswer: normalizeApprovedAnswer(question.approvedAnswer)
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
      if (filter === "ALL") {
        return true;
      }

      return question.reviewStatus === filter;
    });
  }, [data, filter]);

  function getStatusLabel(status: QuestionRow["reviewStatus"]) {
    if (status === "APPROVED") {
      return "Approved";
    }

    if (status === "NEEDS_REVIEW") {
      return "Needs review";
    }

    return "Draft";
  }

  async function approveQuestion(questionId: string) {
    setMessage("");
    setActiveQuestionActionId(questionId);

    try {
      const response = await fetch("/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionId
        })
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to approve answer"));
      }

      setMessage("Answer approved.");
      await loadDetails();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to approve answer");
    } finally {
      setActiveQuestionActionId(null);
    }
  }

  async function updateReviewStatus(questionId: string, reviewStatus: "NEEDS_REVIEW" | "DRAFT") {
    setMessage("");
    setActiveQuestionActionId(questionId);

    try {
      const response = await fetch(`/api/questions/${questionId}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reviewStatus
        })
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to update review status"));
      }

      setMessage(reviewStatus === "NEEDS_REVIEW" ? "Marked as needs review." : "Marked as draft.");
      await loadDetails();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update review status");
    } finally {
      setActiveQuestionActionId(null);
    }
  }

  async function unapprove(approvedAnswerId: string, questionId: string) {
    setMessage("");
    setActiveQuestionActionId(questionId);

    try {
      const response = await fetch(`/api/approved-answers/${approvedAnswerId}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to remove approval"));
      }

      setMessage("Approval removed.");
      await loadDetails();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove approval");
    } finally {
      setActiveQuestionActionId(null);
    }
  }

  function beginEdit(question: QuestionRow) {
    if (!question.approvedAnswer) {
      return;
    }

    setEditingQuestionId(question.id);
    setEditAnswerText(question.approvedAnswer.answerText);
    setEditCitationChunkIdsInput(question.approvedAnswer.citationChunkIds.join("\n"));
  }

  function cancelEdit() {
    setEditingQuestionId(null);
    setEditAnswerText("");
    setEditCitationChunkIdsInput("");
  }

  async function saveEditedApproval(question: QuestionRow) {
    if (!question.approvedAnswer) {
      return;
    }

    const citationChunkIds = parseCitationChunkIdsInput(editCitationChunkIdsInput);
    if (!editAnswerText.trim()) {
      setMessage("Approved answer text cannot be empty.");
      return;
    }

    if (citationChunkIds.length === 0) {
      setMessage("Provide at least one citation chunk ID.");
      return;
    }

    setMessage("");
    setActiveQuestionActionId(question.id);

    try {
      const response = await fetch(`/api/approved-answers/${question.approvedAnswer.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          answerText: editAnswerText.trim(),
          citationChunkIds
        })
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to save approved answer"));
      }

      setMessage("Approved answer updated.");
      cancelEdit();
      await loadDetails();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save approved answer");
    } finally {
      setActiveQuestionActionId(null);
    }
  }

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
              onClick={() => setFilter("DRAFT")}
              disabled={filter === "DRAFT"}
            >
              Draft
            </button>{" "}
            <button
              type="button"
              onClick={() => setFilter("APPROVED")}
              disabled={filter === "APPROVED"}
            >
              Approved
            </button>{" "}
            <button
              type="button"
              onClick={() => setFilter("NEEDS_REVIEW")}
              disabled={filter === "NEEDS_REVIEW"}
            >
              Needs review
            </button>
          </section>

          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Status</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Citations</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={6}>No questions for the selected filter.</td>
                </tr>
              ) : (
                filteredQuestions.map((question) => (
                  <tr key={question.id}>
                    <td>{question.rowIndex}</td>
                    <td>{getStatusLabel(question.reviewStatus)}</td>
                    <td>{question.text || "n/a"}</td>
                    <td>
                      {question.approvedAnswer ? (
                        <>
                          <p>{question.approvedAnswer.answerText}</p>
                          <p>
                            <small>
                              Approved override ({question.approvedAnswer.source.toLowerCase()}) updated{" "}
                              {new Date(question.approvedAnswer.updatedAt).toLocaleString()}
                            </small>
                          </p>
                        </>
                      ) : (
                        question.answer ?? "Not answered yet"
                      )}
                    </td>
                    <td>
                      {question.approvedAnswer ? (
                        question.approvedAnswer.citationChunkIds.length === 0 ? (
                          "none"
                        ) : (
                          <details>
                            <summary>{question.approvedAnswer.citationChunkIds.length} citation chunk ID(s)</summary>
                            <ul>
                              {question.approvedAnswer.citationChunkIds.map((chunkId) => (
                                <li key={`${question.id}-approved-${chunkId}`}>{chunkId}</li>
                              ))}
                            </ul>
                          </details>
                        )
                      ) : (
                        <>
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
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void approveQuestion(question.id)}
                        disabled={
                          activeQuestionActionId === question.id ||
                          !question.answer ||
                          question.answer === NOT_FOUND_ANSWER ||
                          question.answer === NOT_SPECIFIED_ANSWER ||
                          question.citations.length === 0
                        }
                      >
                        {activeQuestionActionId === question.id ? "Working..." : "Approve"}
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => void updateReviewStatus(question.id, "NEEDS_REVIEW")}
                        disabled={activeQuestionActionId === question.id || question.reviewStatus === "NEEDS_REVIEW"}
                      >
                        Mark Needs Review
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => void updateReviewStatus(question.id, "DRAFT")}
                        disabled={activeQuestionActionId === question.id || question.reviewStatus === "DRAFT"}
                      >
                        Mark Draft
                      </button>{" "}
                      {question.approvedAnswer ? (
                        <>
                          <button
                            type="button"
                            onClick={() => beginEdit(question)}
                            disabled={activeQuestionActionId === question.id}
                          >
                            Edit Approved
                          </button>{" "}
                          <button
                            type="button"
                            onClick={() => void unapprove(question.approvedAnswer!.id, question.id)}
                            disabled={activeQuestionActionId === question.id}
                          >
                            Unapprove
                          </button>
                        </>
                      ) : null}

                      {editingQuestionId === question.id && question.approvedAnswer ? (
                        <div>
                          <p>Edit approved answer</p>
                          <textarea
                            value={editAnswerText}
                            onChange={(event) => setEditAnswerText(event.target.value)}
                            rows={4}
                            cols={60}
                          />
                          <p>Citation chunk IDs (comma or newline separated)</p>
                          <textarea
                            value={editCitationChunkIdsInput}
                            onChange={(event) => setEditCitationChunkIdsInput(event.target.value)}
                            rows={3}
                            cols={60}
                          />
                          <div>
                            <button
                              type="button"
                              onClick={() => void saveEditedApproval(question)}
                              disabled={activeQuestionActionId === question.id}
                            >
                              Save
                            </button>{" "}
                            <button type="button" onClick={cancelEdit} disabled={activeQuestionActionId === question.id}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
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
