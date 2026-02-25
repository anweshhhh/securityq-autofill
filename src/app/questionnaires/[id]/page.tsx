"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type QuestionFilter = "ALL" | "DRAFT" | "APPROVED" | "NEEDS_REVIEW" | "NOT_FOUND";
type StatusCounts = Record<QuestionFilter, number>;

type EvidenceItem = {
  chunkId: string;
  docName: string;
  snippet: string;
};

type AutofillPayload = {
  totalCount?: number;
  answeredCount?: number;
  notFoundCount?: number;
  error?: unknown;
};

type DocumentLookupPayload = {
  documents?: Array<{
    id: string;
    name?: string;
    displayName?: string;
    originalName?: string;
  }>;
  error?: unknown;
};

type DocumentDetailsPayload = {
  document?: {
    id: string;
    name: string;
    originalName: string;
    fullText: string;
  };
  error?: unknown;
};

const NOT_FOUND_ANSWER = "Not found in provided documents.";
const FILTER_OPTIONS: Array<{ key: QuestionFilter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "APPROVED", label: "Approved" },
  { key: "NEEDS_REVIEW", label: "Needs review" },
  { key: "NOT_FOUND", label: "Not found" }
];

const QUESTION_TERM_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "being",
  "below",
  "between",
  "could",
  "during",
  "having",
  "other",
  "their",
  "there",
  "these",
  "those",
  "where",
  "which",
  "while",
  "would",
  "your",
  "what",
  "when",
  "from",
  "that",
  "this",
  "with",
  "have",
  "does",
  "they",
  "them",
  "into",
  "also",
  "than",
  "then",
  "such",
  "should",
  "must",
  "need",
  "been",
  "were",
  "will"
]);

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

function isNotFoundAnswer(answer: string | null | undefined): boolean {
  return (answer ?? "").trim() === NOT_FOUND_ANSWER;
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

function getGeneratedEvidenceItems(question: QuestionRow): EvidenceItem[] {
  return question.citations.map((citation) => ({
    chunkId: citation.chunkId,
    docName: citation.docName,
    snippet: citation.quotedSnippet
  }));
}

function buildEvidenceItems(question: QuestionRow, preferApprovedAnswer = true): EvidenceItem[] {
  if (!question.approvedAnswer || !preferApprovedAnswer) {
    return getGeneratedEvidenceItems(question);
  }

  if (question.approvedAnswer.citationChunkIds.length === 0) {
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

function extractCitationChunkIds(question: QuestionRow): string[] {
  return Array.from(
    new Set(
      question.citations
        .map((citation) => citation.chunkId.trim())
        .filter((chunkId) => chunkId.length > 0)
    )
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getQuestionKeyTerms(questionText: string): string[] {
  return Array.from(
    new Set(
      questionText
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4 && !QUESTION_TERM_STOPWORDS.has(term))
    )
  )
    .sort((left, right) => right.length - left.length)
    .slice(0, 10);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toUpperCase();
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.closest("[contenteditable='true']") !== null
  );
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
  const [activeEvidenceChunkId, setActiveEvidenceChunkId] = useState<string | null>(null);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(false);
  const [showGeneratedDraft, setShowGeneratedDraft] = useState(false);
  const [isRunningAutofill, setIsRunningAutofill] = useState(false);
  const [isBulkConfirmOpen, setIsBulkConfirmOpen] = useState(false);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [documentIdByName, setDocumentIdByName] = useState<Record<string, string>>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [documentModalTitle, setDocumentModalTitle] = useState("");
  const [documentModalText, setDocumentModalText] = useState("");
  const [documentModalError, setDocumentModalError] = useState("");
  const evidencePanelRef = useRef<HTMLDivElement | null>(null);

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

  const questionsById = useMemo(() => {
    if (!data) {
      return {} as Record<string, QuestionRow>;
    }

    return data.questions.reduce<Record<string, QuestionRow>>((accumulator, question) => {
      accumulator[question.id] = question;
      return accumulator;
    }, {});
  }, [data]);

  const questionOrder = useMemo(() => {
    return data?.questions.map((question) => question.id) ?? [];
  }, [data]);

  const filteredQuestionIds = useMemo(() => {
    if (!data) {
      return [];
    }

    const loweredSearch = searchText.trim().toLowerCase();
    return questionOrder.filter((questionId) => {
      const question = questionsById[questionId];
      if (!question) {
        return false;
      }

      if (filter === "NOT_FOUND" && !isNotFoundAnswer(question.answer)) {
        return false;
      }

      if (filter !== "ALL" && filter !== "NOT_FOUND" && question.reviewStatus !== filter) {
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
  }, [data, filter, questionOrder, questionsById, searchText]);

  const statusCounts = useMemo<StatusCounts>(() => {
    const counts: StatusCounts = {
      ALL: 0,
      DRAFT: 0,
      APPROVED: 0,
      NEEDS_REVIEW: 0,
      NOT_FOUND: 0
    };

    for (const questionId of questionOrder) {
      const question = questionsById[questionId];
      if (!question) {
        continue;
      }

      counts.ALL += 1;
      counts[question.reviewStatus] += 1;
      if (isNotFoundAnswer(question.answer)) {
        counts.NOT_FOUND += 1;
      }
    }

    return counts;
  }, [questionOrder, questionsById]);

  useEffect(() => {
    if (filteredQuestionIds.length === 0) {
      setSelectedQuestionId(null);
      return;
    }

    setSelectedQuestionId((current) => {
      if (current && filteredQuestionIds.includes(current)) {
        return current;
      }

      return filteredQuestionIds[0];
    });
  }, [filteredQuestionIds]);

  const selectedQuestion = useMemo(
    () => (selectedQuestionId ? questionsById[selectedQuestionId] ?? null : null),
    [questionsById, selectedQuestionId]
  );

  const visibleQuestions = useMemo(() => {
    return filteredQuestionIds
      .map((questionId) => questionsById[questionId])
      .filter((question): question is QuestionRow => Boolean(question));
  }, [filteredQuestionIds, questionsById]);

  const bulkEligibleQuestions = useMemo(() => {
    return visibleQuestions.filter((question) => {
      if (question.reviewStatus === "APPROVED" || question.approvedAnswer) {
        return false;
      }

      return !isNotFoundAnswer(question.answer) && extractCitationChunkIds(question).length > 0;
    });
  }, [visibleQuestions]);

  const approvedProgress = useMemo(() => {
    if (statusCounts.ALL === 0) {
      return 0;
    }

    return Math.round((statusCounts.APPROVED / statusCounts.ALL) * 100);
  }, [statusCounts]);

  const showLoadingSkeletons = isLoading && !data;

  const evidenceItems = useMemo(() => {
    if (!selectedQuestion) {
      return [];
    }

    return buildEvidenceItems(selectedQuestion, !showGeneratedDraft);
  }, [selectedQuestion, showGeneratedDraft]);

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
    setShowGeneratedDraft(false);
    setEditingQuestionId(null);
    setEditAnswerText("");
  }, [selectedQuestionId]);

  useEffect(() => {
    if (!selectedQuestion?.approvedAnswer) {
      setShowGeneratedDraft(false);
    }
  }, [selectedQuestion?.approvedAnswer, selectedQuestion?.id]);

  useEffect(() => {
    let active = true;

    async function loadDocumentLookup() {
      try {
        const response = await fetch("/api/documents", { cache: "no-store" });
        const payload = (await response.json()) as DocumentLookupPayload;
        if (!response.ok) {
          return;
        }

        const nextLookup: Record<string, string> = {};
        for (const document of payload.documents ?? []) {
          const possibleNames = [document.displayName, document.name, document.originalName];
          for (const value of possibleNames) {
            const key = (value ?? "").trim().toLowerCase();
            if (key && !nextLookup[key]) {
              nextLookup[key] = document.id;
            }
          }
        }

        if (active) {
          setDocumentIdByName(nextLookup);
        }
      } catch {
        // Keep evidence view functional even if document lookup fails.
      }
    }

    void loadDocumentLookup();

    return () => {
      active = false;
    };
  }, []);

  const getApprovalCandidate = useCallback((question: QuestionRow): {
    mode: "create" | "update";
    approvedAnswerId: string | null;
    answerText: string;
    citationChunkIds: string[];
  } | null => {
    const hasApprovedAnswer = Boolean(question.approvedAnswer);
    const approvedAnswerId = question.approvedAnswer?.id ?? null;
    const answerText = hasApprovedAnswer
      ? question.approvedAnswer?.answerText.trim() ?? ""
      : (question.answer ?? "").trim();
    const citationChunkIds = hasApprovedAnswer
      ? question.approvedAnswer?.citationChunkIds.filter((chunkId) => chunkId.trim().length > 0) ?? []
      : extractCitationChunkIds(question);

    if (hasApprovedAnswer && !approvedAnswerId) {
      return null;
    }

    if (!answerText || isNotFoundAnswer(answerText) || citationChunkIds.length === 0) {
      return null;
    }

    return {
      mode: hasApprovedAnswer ? "update" : "create",
      approvedAnswerId,
      answerText,
      citationChunkIds
    };
  }, []);

  const persistApproval = useCallback(
    async (question: QuestionRow): Promise<{ ok: true } | { ok: false; message: string }> => {
      const candidate = getApprovalCandidate(question);
      if (!candidate) {
        return {
          ok: false,
          message: "Approval requires a non-not-found answer with at least one citation."
        };
      }

      const response =
        candidate.mode === "update" && candidate.approvedAnswerId
          ? await fetch(`/api/approved-answers/${candidate.approvedAnswerId}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                answerText: candidate.answerText,
                citationChunkIds: candidate.citationChunkIds
              })
            })
          : await fetch("/api/approved-answers", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                questionId: question.id,
                answerText: candidate.answerText,
                citationChunkIds: candidate.citationChunkIds,
                source: "GENERATED"
              })
            });

      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        return {
          ok: false,
          message: getApiErrorMessage(payload, "Failed to persist approval.")
        };
      }

      return { ok: true };
    },
    [getApprovalCandidate]
  );

  async function runAutofill() {
    setMessage("");
    setIsRunningAutofill(true);

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      });
      const payload = (await response.json()) as AutofillPayload;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Autofill failed."));
      }

      setMessage(
        `Autofill complete: ${payload.answeredCount ?? 0}/${payload.totalCount ?? 0} answered, ${payload.notFoundCount ?? 0} not found.`
      );
      await loadDetails();
    } catch (error) {
      setMessage(`Autofill failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setIsRunningAutofill(false);
    }
  }

  async function approveVisibleQuestions() {
    if (bulkEligibleQuestions.length === 0) {
      setMessage("No visible questions are eligible for approval.");
      setIsBulkConfirmOpen(false);
      return;
    }

    setMessage("");
    setIsBulkApproving(true);
    setIsBulkConfirmOpen(false);

    let succeeded = 0;
    let failed = 0;
    let firstFailureMessage = "";
    let cursor = 0;
    const concurrency = Math.min(6, bulkEligibleQuestions.length);

    await Promise.all(
      Array.from({ length: concurrency }).map(async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= bulkEligibleQuestions.length) {
            return;
          }

          const question = bulkEligibleQuestions[index];
          const result = await persistApproval(question);
          if (result.ok) {
            succeeded += 1;
          } else {
            failed += 1;
            if (!firstFailureMessage) {
              firstFailureMessage = result.message;
            }
          }
        }
      })
    );

    setIsBulkApproving(false);

    if (failed > 0) {
      setMessage(
        `Bulk approval complete: ${succeeded} approved, ${failed} failed. ${firstFailureMessage ? `First error: ${firstFailureMessage}` : ""}`
      );
    } else {
      setMessage(`Bulk approval complete: ${succeeded} questions approved.`);
    }

    await loadDetails();
  }

  const approveQuestion = useCallback(async (question: QuestionRow) => {
    setMessage("");
    setActiveQuestionActionId(question.id);

    try {
      const result = await persistApproval(question);
      if (!result.ok) {
        setMessage(`Approve failed: ${result.message}`);
        return;
      }

      setMessage(question.approvedAnswer ? "Approval refreshed from saved values." : "Answer approved.");
      await loadDetails();
    } catch (error) {
      setMessage(`Approve failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setActiveQuestionActionId(null);
    }
  }, [loadDetails, persistApproval]);

  const updateReviewStatus = useCallback(async (questionId: string, reviewStatus: "NEEDS_REVIEW" | "DRAFT") => {
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
      setMessage(`Unable to update review status: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setActiveQuestionActionId(null);
    }
  }, [loadDetails]);

  const unapprove = useCallback(async (approvedAnswerId: string, questionId: string) => {
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
      setMessage(`Unable to remove approval: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setActiveQuestionActionId(null);
    }
  }, [loadDetails]);

  function beginEdit(question: QuestionRow) {
    if (!question.approvedAnswer) {
      return;
    }

    setEditingQuestionId(question.id);
    setEditAnswerText(question.approvedAnswer.answerText);
  }

  function cancelEdit() {
    setEditingQuestionId(null);
    setEditAnswerText("");
  }

  async function saveEditedApproval(question: QuestionRow) {
    if (!question.approvedAnswer) {
      return;
    }

    const citationChunkIds = question.approvedAnswer.citationChunkIds.filter(
      (chunkId) => chunkId.trim().length > 0
    );
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
      setMessage(`Unable to save approved answer: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setActiveQuestionActionId(null);
    }
  }

  const copyText = useCallback(async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
    } catch {
      setMessage("Unable to copy to clipboard.");
    }
  }, []);

  const openDocumentModal = useCallback(
    async (docName: string) => {
      const lookupKey = docName.trim().toLowerCase();
      const documentId = documentIdByName[lookupKey];

      if (!documentId) {
        setMessage(`Document preview unavailable for "${docName}".`);
        return;
      }

      setIsDocumentModalOpen(true);
      setIsDocumentLoading(true);
      setDocumentModalError("");
      setDocumentModalText("");
      setDocumentModalTitle(docName);

      try {
        const response = await fetch(`/api/documents/${documentId}`, { cache: "no-store" });
        const payload = (await response.json()) as DocumentDetailsPayload;
        if (!response.ok || !payload.document) {
          throw new Error(getApiErrorMessage(payload, "Failed to load document text."));
        }

        setDocumentModalTitle(payload.document.name || payload.document.originalName || docName);
        setDocumentModalText(payload.document.fullText || "");
      } catch (error) {
        setDocumentModalError(error instanceof Error ? error.message : "Failed to load document text.");
      } finally {
        setIsDocumentLoading(false);
      }
    },
    [documentIdByName]
  );

  const closeDocumentModal = useCallback(() => {
    setIsDocumentModalOpen(false);
    setIsDocumentLoading(false);
    setDocumentModalError("");
    setDocumentModalText("");
  }, []);

  const activeEvidence = evidenceItems.find((item) => item.chunkId === activeEvidenceChunkId) ?? null;
  const generatedAnswer = (selectedQuestion?.answer ?? "").trim() || "Not answered yet.";
  const approvedAnswer = selectedQuestion?.approvedAnswer?.answerText ?? "";
  const showingGeneratedComparison = Boolean(selectedQuestion?.approvedAnswer) && showGeneratedDraft;
  const effectiveAnswer = showingGeneratedComparison ? generatedAnswer : approvedAnswer || generatedAnswer;
  const effectiveCitationIds = evidenceItems.map((item) => item.chunkId);
  const selectedQuestionApprovalCandidate = selectedQuestion ? getApprovalCandidate(selectedQuestion) : null;
  const questionKeyTerms = useMemo(
    () => getQuestionKeyTerms(selectedQuestion?.text ?? ""),
    [selectedQuestion?.text]
  );
  const highlightedSnippetParts = useMemo(() => {
    const snippet = activeEvidence?.snippet ?? "";
    if (!snippet || questionKeyTerms.length === 0) {
      return [snippet];
    }

    const pattern = new RegExp(`(${questionKeyTerms.map(escapeRegExp).join("|")})`, "gi");
    const segments = snippet.split(pattern);
    return segments.map((segment, index) => {
      if (segment && questionKeyTerms.some((term) => term === segment.toLowerCase())) {
        return (
          <mark key={`segment-${index}`} className="snippet-highlight">
            {segment}
          </mark>
        );
      }

      return <span key={`segment-${index}`}>{segment}</span>;
    });
  }, [activeEvidence?.snippet, questionKeyTerms]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "escape") {
        if (isBulkConfirmOpen) {
          event.preventDefault();
          setIsBulkConfirmOpen(false);
        }
        if (isShortcutsOpen) {
          event.preventDefault();
          setIsShortcutsOpen(false);
        }
        if (isDocumentModalOpen) {
          event.preventDefault();
          closeDocumentModal();
        }
      }

      if (isBulkConfirmOpen || isShortcutsOpen || isDocumentModalOpen) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      if (key === "j") {
        event.preventDefault();
        if (filteredQuestionIds.length === 0) {
          return;
        }

        setSelectedQuestionId((current) => {
          if (!current) {
            return filteredQuestionIds[0];
          }

          const currentIndex = filteredQuestionIds.indexOf(current);
          if (currentIndex < 0) {
            return filteredQuestionIds[0];
          }

          return filteredQuestionIds[Math.min(currentIndex + 1, filteredQuestionIds.length - 1)];
        });
        return;
      }

      if (key === "k") {
        event.preventDefault();
        if (filteredQuestionIds.length === 0) {
          return;
        }

        setSelectedQuestionId((current) => {
          if (!current) {
            return filteredQuestionIds[0];
          }

          const currentIndex = filteredQuestionIds.indexOf(current);
          if (currentIndex < 0) {
            return filteredQuestionIds[0];
          }

          return filteredQuestionIds[Math.max(currentIndex - 1, 0)];
        });
        return;
      }

      if (key === "a" && selectedQuestion && selectedQuestionApprovalCandidate && !isBulkApproving) {
        event.preventDefault();
        void approveQuestion(selectedQuestion);
        return;
      }

      if (key === "r" && selectedQuestion && !isBulkApproving && selectedQuestion.reviewStatus !== "NEEDS_REVIEW") {
        event.preventDefault();
        void updateReviewStatus(selectedQuestion.id, "NEEDS_REVIEW");
        return;
      }

      if (key === "u" && selectedQuestion?.approvedAnswer && !isBulkApproving) {
        event.preventDefault();
        void unapprove(selectedQuestion.approvedAnswer.id, selectedQuestion.id);
        return;
      }

      if (key === "c") {
        event.preventDefault();
        void copyText(effectiveAnswer, "Answer copied.");
        return;
      }

      if (key === "e") {
        event.preventDefault();
        evidencePanelRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    approveQuestion,
    copyText,
    effectiveAnswer,
    filteredQuestionIds,
    isBulkConfirmOpen,
    isBulkApproving,
    isDocumentModalOpen,
    isShortcutsOpen,
    selectedQuestion,
    selectedQuestionApprovalCandidate,
    closeDocumentModal,
    unapprove,
    updateReviewStatus
  ]);

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
            <Button type="button" variant="ghost" onClick={() => void loadDetails()} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="trust-bar">
        <div className="trust-bar-header">
          <div>
            <h3 style={{ margin: 0 }}>Trust Bar</h3>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Review velocity controls and approval coverage snapshot.
            </p>
          </div>
          <div className="toolbar-row">
            <Button
              type="button"
              variant="primary"
              onClick={() => setIsBulkConfirmOpen(true)}
              disabled={isLoading || isBulkApproving || bulkEligibleQuestions.length === 0}
              title="Approve all currently visible eligible questions"
              aria-label="Approve visible eligible questions"
            >
              {isBulkApproving ? "Approving..." : `Approve Visible (${bulkEligibleQuestions.length})`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void runAutofill()}
              disabled={isRunningAutofill || isBulkApproving}
              title="Run autofill for this questionnaire"
              aria-label="Run autofill for questionnaire"
            >
              {isRunningAutofill ? "Running..." : "Run Autofill"}
            </Button>
            <a
              className="btn btn-ghost"
              href={`/api/questionnaires/${questionnaireId}/export`}
              aria-label="Export questionnaire CSV"
              title="Export preferred answers to CSV"
            >
              Export
            </a>
            <Button
              type="button"
              variant="ghost"
              className="icon-btn"
              onClick={() => setIsShortcutsOpen(true)}
              aria-label="Show keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              ?
            </Button>
          </div>
        </div>
        <div className="trust-bar-metrics">
          <Badge tone="approved">Approved {statusCounts.APPROVED}</Badge>
          <Badge tone="review">Needs review {statusCounts.NEEDS_REVIEW}</Badge>
          <Badge tone="draft">Draft {statusCounts.DRAFT}</Badge>
          <Badge tone="notfound">Not found {statusCounts.NOT_FOUND}</Badge>
          <div className="trust-progress">
            <div className="small muted">Approved progress</div>
            <div className="trust-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={approvedProgress}>
              <div className="trust-progress-fill" style={{ width: `${approvedProgress}%` }} />
            </div>
            <div className="small">{approvedProgress}% approved</div>
          </div>
        </div>
      </Card>

      {message ? (
        <div
          className={cx(
            "message-banner",
            message.toLowerCase().includes("fail") ||
              message.toLowerCase().includes("error") ||
              message.toLowerCase().includes("unable")
              ? "error"
              : message.toLowerCase().includes("approved") ||
                  message.toLowerCase().includes("updated") ||
                  message.toLowerCase().includes("marked") ||
                  message.toLowerCase().includes("removed") ||
                  message.toLowerCase().includes("complete")
                ? "success"
                : ""
          )}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      ) : null}

      {showLoadingSkeletons ? (
        <div className="workbench-grid">
          <Card className="sticky-panel">
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line" />
            <div className="skeleton-list">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={`rail-skeleton-${index}`} className="skeleton-block" />
              ))}
            </div>
          </Card>
          <Card>
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-block skeleton-answer" />
            <div className="skeleton-block skeleton-answer" />
          </Card>
          <Card className="sticky-panel">
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-block skeleton-answer" />
            <div className="skeleton-block skeleton-answer" />
          </Card>
        </div>
      ) : (
        <div className="workbench-grid">
        <Card className="sticky-panel">
          <div className="card-title-row">
            <h3 style={{ margin: 0 }}>Questions</h3>
            <Badge tone="draft">{filteredQuestionIds.length} visible</Badge>
          </div>

          <TextInput
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search question text or answer"
          />

          <div className="toolbar-row" style={{ marginTop: 10 }}>
            {FILTER_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={cx("chip", filter === key && "active")}
                onClick={() => setFilter(key)}
                title={`Filter by ${label.toLowerCase()}`}
              >
                {label} ({statusCounts[key]})
              </button>
            ))}
          </div>

          <div className="question-list" style={{ marginTop: 12 }}>
            {filteredQuestionIds.length === 0 ? (
              <div className="muted small">No questions match the current filters.</div>
            ) : (
              filteredQuestionIds.map((questionId) => {
                const question = questionsById[questionId];
                if (!question) {
                  return null;
                }

                return (
                  <button
                    key={question.id}
                    type="button"
                    className={cx("question-list-item", selectedQuestionId === question.id && "active")}
                    onClick={() => setSelectedQuestionId(question.id)}
                    title={`Row ${question.rowIndex}`}
                  >
                    <div className="card-title-row" style={{ marginBottom: 8 }}>
                      <span className="small muted">Row {question.rowIndex + 1}</span>
                      <div className="toolbar-row compact">
                        <Badge tone={statusTone(question.reviewStatus)} title={statusLabel(question.reviewStatus)}>
                          {statusLabel(question.reviewStatus)}
                        </Badge>
                        {isNotFoundAnswer(question.answer) ? <Badge tone="notfound">Not found</Badge> : null}
                      </div>
                    </div>
                    <div className="answer-preview">{question.text || "No question text"}</div>
                  </button>
                );
              })
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
                <p className="workbench-question-text" style={{ margin: 0 }}>
                  {selectedQuestion.text || "No question text available."}
                </p>
              </Card>

              <Card style={{ marginTop: 12 }}>
                <div className="card-title-row">
                  <h3 style={{ margin: 0 }}>
                    {selectedQuestion.approvedAnswer && !showingGeneratedComparison ? "Approved Answer" : "Generated Draft"}
                  </h3>
                  <div className="toolbar-row">
                    {selectedQuestion.approvedAnswer ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setShowGeneratedDraft((value) => !value)}
                        title={showingGeneratedComparison ? "Show approved answer" : "Show generated draft"}
                      >
                        {showingGeneratedComparison ? "Show Approved" : "Show Generated"}
                      </Button>
                    ) : null}
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
                    {showingGeneratedComparison ? "Comparing with generated draft. " : "Showing approved answer. "}
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
                    onClick={() => void approveQuestion(selectedQuestion)}
                    disabled={
                      activeQuestionActionId === selectedQuestion.id || isBulkApproving || !selectedQuestionApprovalCandidate
                    }
                    aria-label="Approve selected answer"
                  >
                    {activeQuestionActionId === selectedQuestion.id ? "Working..." : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void updateReviewStatus(selectedQuestion.id, "NEEDS_REVIEW")}
                    disabled={
                      activeQuestionActionId === selectedQuestion.id ||
                      isBulkApproving ||
                      selectedQuestion.reviewStatus === "NEEDS_REVIEW"
                    }
                    aria-label="Mark selected question as needs review"
                  >
                    Mark Needs Review
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void updateReviewStatus(selectedQuestion.id, "DRAFT")}
                    disabled={
                      activeQuestionActionId === selectedQuestion.id ||
                      isBulkApproving ||
                      selectedQuestion.reviewStatus === "DRAFT"
                    }
                    aria-label="Mark selected question as draft"
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
                    disabled={activeQuestionActionId === selectedQuestion.id || isBulkApproving || !selectedQuestion.approvedAnswer}
                    aria-label="Remove selected approval"
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
                          Citations are preserved from the current approved answer.
                        </p>
                        <div className="toolbar-row" style={{ marginTop: 10 }}>
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => void saveEditedApproval(selectedQuestion)}
                            disabled={activeQuestionActionId === selectedQuestion.id || isBulkApproving}
                          >
                            Save approved edit
                          </Button>
                          <Button type="button" variant="ghost" onClick={cancelEdit} disabled={isBulkApproving}>
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

        <Card className="workbench-evidence sticky-panel">
          <div ref={evidencePanelRef} tabIndex={0} className="focus-target" role="region" aria-label="Evidence panel">
          <div className="card-title-row">
            <h3 style={{ margin: 0 }}>Evidence</h3>
            <div className="toolbar-row">
              <Badge tone="draft" title="Citations linked to current answer">
                {evidenceItems.length} citation(s)
              </Badge>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(effectiveCitationIds.join(", "), "All citation IDs copied.")}
                disabled={effectiveCitationIds.length === 0}
                title="Copy all citation chunk IDs"
              >
                Copy All Citations
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void copyText(activeEvidence?.snippet ?? "", "Snippet copied.")}
                disabled={!activeEvidence?.snippet}
                title="Copy selected snippet text"
              >
                Copy Snippet
              </Button>
            </div>
          </div>

          {evidenceItems.length === 0 ? (
            <div className="muted small">No citations available for the current question.</div>
          ) : (
            <>
              <div className="evidence-chip-list">
                {evidenceItems.map((item) => (
                  <div key={item.chunkId} className={cx("evidence-chip-item", item.chunkId === activeEvidenceChunkId && "active")}>
                    <button
                      type="button"
                      className={cx("chip", item.chunkId === activeEvidenceChunkId && "active")}
                      onClick={() => setActiveEvidenceChunkId(item.chunkId)}
                      title={`${item.docName}#${item.chunkId}`}
                    >
                      <span>{item.docName}</span>
                      <span className="mono-id">...{item.chunkId.slice(-6)}</span>
                    </button>
                    <button
                      type="button"
                      className="mini-chip-action"
                      onClick={() => void copyText(item.chunkId, "Chunk ID copied.")}
                      title={`Copy chunk id ${item.chunkId}`}
                      aria-label={`Copy chunk id ${item.chunkId}`}
                    >
                      Copy ID
                    </button>
                    <button
                      type="button"
                      className="mini-chip-action"
                      onClick={() => void openDocumentModal(item.docName)}
                      title={`Open source document ${item.docName}`}
                      aria-label={`Open source document ${item.docName}`}
                    >
                      Open Doc
                    </button>
                  </div>
                ))}
              </div>
              <div className="snippet-scroll" style={{ marginTop: 10 }}>
                {activeEvidence ? highlightedSnippetParts : "Select a citation chip to view snippet text."}
              </div>
            </>
          )}
          </div>
        </Card>
        </div>
      )}

      {isBulkConfirmOpen ? (
        <div className="overlay-modal" role="dialog" aria-modal="true" aria-label="Confirm bulk approval">
          <div className="overlay-modal-card">
            <h3 style={{ marginTop: 0 }}>Approve Visible Questions</h3>
            <p style={{ margin: "8px 0" }}>
              You are about to approve <strong>{bulkEligibleQuestions.length}</strong> visible questions.
            </p>
            <p className="small muted" style={{ marginTop: 0 }}>
              Only questions with non-NOT_FOUND answers and non-empty citations are eligible.
            </p>
            <div className="toolbar-row">
              <Button type="button" variant="primary" onClick={() => void approveVisibleQuestions()} disabled={isBulkApproving}>
                Confirm Approve Visible
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsBulkConfirmOpen(false)} disabled={isBulkApproving}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isShortcutsOpen ? (
        <div className="overlay-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <div className="overlay-modal-card">
            <h3 style={{ marginTop: 0 }}>Keyboard Shortcuts</h3>
            <div className="shortcut-grid">
              <div><kbd>J</kbd> Next question</div>
              <div><kbd>K</kbd> Previous question</div>
              <div><kbd>A</kbd> Approve selected</div>
              <div><kbd>R</kbd> Mark needs review</div>
              <div><kbd>U</kbd> Unapprove selected</div>
              <div><kbd>C</kbd> Copy answer</div>
              <div><kbd>E</kbd> Focus evidence panel</div>
              <div><kbd>?</kbd> Open shortcuts</div>
            </div>
            <p className="small muted">Shortcuts are ignored while typing in inputs/text areas.</p>
            <div className="toolbar-row">
              <Button type="button" variant="primary" onClick={() => setIsShortcutsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isDocumentModalOpen ? (
        <div className="overlay-modal" role="dialog" aria-modal="true" aria-label="Document preview">
          <div className="overlay-modal-card document-modal-card">
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>{documentModalTitle || "Document preview"}</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              Read-only source text from uploaded evidence.
            </p>
            {isDocumentLoading ? <div className="skeleton-block document-skeleton" /> : null}
            {documentModalError ? <div className="message-banner error">{documentModalError}</div> : null}
            {!isDocumentLoading && !documentModalError ? (
              <div className="document-text-scroll">{documentModalText || "No document text available."}</div>
            ) : null}
            <div className="toolbar-row" style={{ marginTop: 10 }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(documentModalText, "Document text copied.")}
                disabled={isDocumentLoading || !documentModalText}
              >
                Copy Document Text
              </Button>
              <Button type="button" variant="primary" onClick={closeDocumentModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
