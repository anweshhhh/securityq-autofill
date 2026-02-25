"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, TextArea, TextInput, cx } from "@/components/ui";

type Citation = {
  docName: string;
  chunkId: string;
  quotedSnippet: string;
};

type ApprovedAnswer = {
  id: string;
  answerText: string;
  citationChunkIds: string[];
  source: "GENERATED" | "MANUAL_EDIT";
  note: string | null;
  updatedAt: string;
};

type QuestionRow = {
  id: string;
  rowIndex: number;
  text: string;
  answer: string | null;
  citations: Citation[];
  reviewStatus: "DRAFT" | "APPROVED" | "NEEDS_REVIEW";
  approvedAnswer: ApprovedAnswer | null;
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

type EvidenceItem = {
  chunkId: string;
  docName: string;
  snippet: string;
};

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

function normalizeApprovedAnswer(value: unknown): ApprovedAnswer | null {
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

function statusTone(status: QuestionRow["reviewStatus"]): "approved" | "review" | "draft" {
  if (status === "APPROVED") {
    return "approved";
  }

  if (status === "NEEDS_REVIEW") {
    return "review";
  }

  return "draft";
}

function statusLabel(status: QuestionRow["reviewStatus"]) {
  if (status === "APPROVED") {
    return "Approved";
  }
  if (status === "NEEDS_REVIEW") {
    return "Needs review";
  }
  return "Draft";
}

function buildEvidenceItems(question: QuestionRow): EvidenceItem[] {
  if (!question.approvedAnswer) {
    return question.citations.map((citation) => ({
      chunkId: citation.chunkId,
      docName: citation.docName,
      snippet: citation.quotedSnippet
    }));
  }

  const generatedByChunkId = new Map(question.citations.map((citation) => [citation.chunkId, citation]));
  return question.approvedAnswer.citationChunkIds.map((chunkId) => {
    const generated = generatedByChunkId.get(chunkId);
    if (generated) {
      return {
        chunkId,
        docName: generated.docName,
        snippet: generated.quotedSnippet
      };
    }

    return {
      chunkId,
      docName: "Approved override",
      snippet: "Snippet preview unavailable for this approved citation chunk ID."
    };
  });
}

export default function QuestionnaireDetailsPage() {
  const params = useParams<{ id: string }>();
  const questionnaireId = params.id;

  const [data, setData] = useState<QuestionnaireDetailsPayload | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<QuestionFilter>("ALL");
  const [searchText, setSearchText] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [activeQuestionActionId, setActiveQuestionActionId] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editAnswerText, setEditAnswerText] = useState("");
  const [editCitationChunkIdsInput, setEditCitationChunkIdsInput] = useState("");
  const [activeEvidenceChunkId, setActiveEvidenceChunkId] = useState<string | null>(null);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(false);

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

      const normalizedQuestions = (payload.questions ?? []).map((question) => ({
        ...question,
        citations: normalizeCitations(question.citations),
        reviewStatus: (() => {
          const normalizedStatus: QuestionRow["reviewStatus"] =
            question.reviewStatus === "APPROVED" || question.reviewStatus === "NEEDS_REVIEW"
              ? question.reviewStatus
              : "DRAFT";
          return normalizedStatus;
        })(),
        approvedAnswer: normalizeApprovedAnswer(question.approvedAnswer)
      }));

      setData({
        questionnaire: payload.questionnaire,
        questions: normalizedQuestions
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

    const loweredSearch = searchText.trim().toLowerCase();
    return data.questions.filter((question) => {
      if (filter !== "ALL" && question.reviewStatus !== filter) {
        return false;
      }

      if (!loweredSearch) {
        return true;
      }

      return (
        question.text.toLowerCase().includes(loweredSearch) ||
        (question.answer ?? "").toLowerCase().includes(loweredSearch) ||
        (question.approvedAnswer?.answerText ?? "").toLowerCase().includes(loweredSearch)
      );
    });
  }, [data, filter, searchText]);

  const statusCounts = useMemo(() => {
    if (!data) {
      return {
        ALL: 0,
        DRAFT: 0,
        APPROVED: 0,
        NEEDS_REVIEW: 0
      };
    }

    return data.questions.reduce(
      (counts, question) => {
        counts.ALL += 1;
        counts[question.reviewStatus] += 1;
        return counts;
      },
      {
        ALL: 0,
        DRAFT: 0,
        APPROVED: 0,
        NEEDS_REVIEW: 0
      }
    );
  }, [data]);

  useEffect(() => {
    if (filteredQuestions.length === 0) {
      setSelectedQuestionId(null);
      return;
    }

    setSelectedQuestionId((current) => {
      if (current && filteredQuestions.some((question) => question.id === current)) {
        return current;
      }

      return filteredQuestions[0].id;
    });
  }, [filteredQuestions]);

  const selectedQuestion = useMemo(
    () => filteredQuestions.find((question) => question.id === selectedQuestionId) ?? null,
    [filteredQuestions, selectedQuestionId]
  );

  const evidenceItems = useMemo(() => {
    if (!selectedQuestion) {
      return [];
    }

    return buildEvidenceItems(selectedQuestion);
  }, [selectedQuestion]);

  useEffect(() => {
    if (evidenceItems.length === 0) {
      setActiveEvidenceChunkId(null);
      return;
    }

    setActiveEvidenceChunkId((current) => {
      if (current && evidenceItems.some((item) => item.chunkId === current)) {
        return current;
      }

      return evidenceItems[0].chunkId;
    });
  }, [evidenceItems]);

  useEffect(() => {
    setIsAnswerExpanded(false);
    setEditingQuestionId(null);
    setEditAnswerText("");
    setEditCitationChunkIdsInput("");
  }, [selectedQuestionId]);

  async function approveQuestion(questionId: string) {
    setMessage("");
    setActiveQuestionActionId(questionId);

    try {
      const response = await fetch("/api/approved-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ questionId })
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

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
    } catch {
      setMessage("Unable to copy to clipboard.");
    }
  }

  const activeEvidence = evidenceItems.find((item) => item.chunkId === activeEvidenceChunkId) ?? null;
  const effectiveAnswer = selectedQuestion?.approvedAnswer?.answerText ?? selectedQuestion?.answer ?? "Not answered yet.";
  const effectiveCitationIds = evidenceItems.map((item) => item.chunkId);

  return (
    <div className="page-stack">
      <Card>
        <div className="card-title-row">
          <div>
            <h2 style={{ marginBottom: 4 }}>{data?.questionnaire.name ?? "Questionnaire"}</h2>
            <p className="muted" style={{ margin: 0 }}>
              Source: {data?.questionnaire.sourceFileName ?? "n/a"} | Question column:{" "}
              {data?.questionnaire.questionColumn ?? "n/a"}
            </p>
          </div>
          <div className="toolbar-row">
            <a className="btn btn-secondary" href={`/api/questionnaires/${questionnaireId}/export`}>
              Export (preferred)
            </a>
            <a className="btn btn-ghost" href={`/api/questionnaires/${questionnaireId}/export?mode=approvedOnly`}>
              Export approved only
            </a>
            <Button type="button" variant="ghost" onClick={() => void loadDetails()} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>
        {message ? (
          <Badge tone={message.toLowerCase().includes("fail") ? "notfound" : "review"}>{message}</Badge>
        ) : null}
      </Card>

      <div className="workbench-grid">
        <Card>
          <div className="card-title-row">
            <h3 style={{ margin: 0 }}>Questions</h3>
            <Badge tone="draft">{filteredQuestions.length} visible</Badge>
          </div>

          <TextInput
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search question text or answer"
          />

          <div className="toolbar-row" style={{ marginTop: 10 }}>
            {(["ALL", "DRAFT", "APPROVED", "NEEDS_REVIEW"] as QuestionFilter[]).map((status) => (
              <button
                key={status}
                type="button"
                className={cx("chip", filter === status && "active")}
                onClick={() => setFilter(status)}
                title={`Filter by ${status.replace("_", " ").toLowerCase()}`}
              >
                {status === "ALL" ? "All" : status.replace("_", " ")} ({statusCounts[status]})
              </button>
            ))}
          </div>

          <div className="question-list" style={{ marginTop: 12 }}>
            {filteredQuestions.length === 0 ? (
              <div className="muted small">No questions match the current filters.</div>
            ) : (
              filteredQuestions.map((question) => (
                <button
                  key={question.id}
                  type="button"
                  className={cx("question-list-item", selectedQuestionId === question.id && "active")}
                  onClick={() => setSelectedQuestionId(question.id)}
                  title={`Row ${question.rowIndex}`}
                >
                  <div className="card-title-row" style={{ marginBottom: 8 }}>
                    <span className="small muted">Row {question.rowIndex + 1}</span>
                    <Badge tone={statusTone(question.reviewStatus)} title={statusLabel(question.reviewStatus)}>
                      {statusLabel(question.reviewStatus)}
                    </Badge>
                  </div>
                  <div className="answer-preview">{question.text || "No question text"}</div>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card>
          {selectedQuestion ? (
            <>
              <div className="card-title-row">
                <div>
                  <h3 style={{ marginBottom: 6 }}>Question</h3>
                  <Badge tone={statusTone(selectedQuestion.reviewStatus)} title={statusLabel(selectedQuestion.reviewStatus)}>
                    {statusLabel(selectedQuestion.reviewStatus)}
                  </Badge>
                </div>
                <span className="small muted">Row {selectedQuestion.rowIndex + 1}</span>
              </div>

              <Card className="card-muted">
                <p style={{ margin: 0 }}>{selectedQuestion.text || "No question text available."}</p>
              </Card>

              <Card style={{ marginTop: 12 }}>
                <div className="card-title-row">
                  <h3 style={{ margin: 0 }}>Answer</h3>
                  <div className="toolbar-row">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setIsAnswerExpanded((value) => !value)}
                      title={isAnswerExpanded ? "Collapse answer" : "Expand answer"}
                    >
                      {isAnswerExpanded ? "Collapse" : "Expand"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void copyText(effectiveAnswer, "Answer copied.")}
                      title="Copy answer text"
                    >
                      Copy answer
                    </Button>
                  </div>
                </div>

                <div className={isAnswerExpanded ? "answer-scroll" : "answer-preview"}>{effectiveAnswer}</div>
                {selectedQuestion.approvedAnswer ? (
                  <p className="small muted" style={{ marginTop: 10 }}>
                    Approved override ({selectedQuestion.approvedAnswer.source.toLowerCase()}) updated{" "}
                    {new Date(selectedQuestion.approvedAnswer.updatedAt).toLocaleString()}.
                  </p>
                ) : null}
              </Card>

              <Card style={{ marginTop: 12 }}>
                <div className="card-title-row">
                  <h3 style={{ margin: 0 }}>Quick actions</h3>
                </div>
                <div className="toolbar-row">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void approveQuestion(selectedQuestion.id)}
                    disabled={
                      activeQuestionActionId === selectedQuestion.id ||
                      !selectedQuestion.answer ||
                      selectedQuestion.answer === NOT_FOUND_ANSWER ||
                      selectedQuestion.citations.length === 0
                    }
                  >
                    {activeQuestionActionId === selectedQuestion.id ? "Working..." : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void updateReviewStatus(selectedQuestion.id, "NEEDS_REVIEW")}
                    disabled={
                      activeQuestionActionId === selectedQuestion.id ||
                      selectedQuestion.reviewStatus === "NEEDS_REVIEW"
                    }
                  >
                    Mark Needs Review
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void updateReviewStatus(selectedQuestion.id, "DRAFT")}
                    disabled={activeQuestionActionId === selectedQuestion.id || selectedQuestion.reviewStatus === "DRAFT"}
                  >
                    Mark Draft
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => {
                      if (selectedQuestion.approvedAnswer) {
                        void unapprove(selectedQuestion.approvedAnswer.id, selectedQuestion.id);
                      }
                    }}
                    disabled={activeQuestionActionId === selectedQuestion.id || !selectedQuestion.approvedAnswer}
                  >
                    Unapprove
                  </Button>
                </div>

                {selectedQuestion.approvedAnswer ? (
                  <div style={{ marginTop: 12 }}>
                    {editingQuestionId === selectedQuestion.id ? (
                      <>
                        <TextArea
                          rows={5}
                          value={editAnswerText}
                          onChange={(event) => setEditAnswerText(event.target.value)}
                        />
                        <p className="small muted" style={{ margin: "10px 0 6px" }}>
                          Citation chunk IDs (comma or newline separated)
                        </p>
                        <TextArea
                          rows={3}
                          value={editCitationChunkIdsInput}
                          onChange={(event) => setEditCitationChunkIdsInput(event.target.value)}
                        />
                        <div className="toolbar-row" style={{ marginTop: 10 }}>
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => void saveEditedApproval(selectedQuestion)}
                            disabled={activeQuestionActionId === selectedQuestion.id}
                          >
                            Save approved edit
                          </Button>
                          <Button type="button" variant="ghost" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Button type="button" variant="secondary" onClick={() => beginEdit(selectedQuestion)}>
                        Edit approved answer
                      </Button>
                    )}
                  </div>
                ) : null}
              </Card>
            </>
          ) : (
            <div className="muted">Select a question from the left panel.</div>
          )}
        </Card>

        <Card className="workbench-evidence">
          <div className="card-title-row">
            <h3 style={{ margin: 0 }}>Evidence</h3>
            <div className="toolbar-row">
              <Badge tone="draft" title="Citations linked to current answer">
                {evidenceItems.length} citation(s)
              </Badge>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(effectiveCitationIds.join(", "), "Citation IDs copied.")}
                disabled={effectiveCitationIds.length === 0}
                title="Copy citation chunk IDs"
              >
                Copy IDs
              </Button>
            </div>
          </div>

          {evidenceItems.length === 0 ? (
            <div className="muted small">No citations available for the current question.</div>
          ) : (
            <>
              <div className="toolbar-row">
                {evidenceItems.map((item) => (
                  <button
                    key={item.chunkId}
                    type="button"
                    className={cx("chip", item.chunkId === activeEvidenceChunkId && "active")}
                    onClick={() => setActiveEvidenceChunkId(item.chunkId)}
                    title={`${item.docName}#${item.chunkId}`}
                  >
                    {item.docName}#{item.chunkId.slice(0, 8)}
                  </button>
                ))}
              </div>
              <div className="snippet-scroll" style={{ marginTop: 10 }}>
                {activeEvidence ? activeEvidence.snippet : "Select a citation chip to view snippet text."}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
