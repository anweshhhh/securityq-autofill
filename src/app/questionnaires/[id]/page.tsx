"use client";

import { useParams } from "next/navigation";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ExportModal } from "@/components/ExportModal";
import { Badge, Button, Card, TextArea, TextInput, cx } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";

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
  updatedAt: string;
  reviewStatus: "DRAFT" | "APPROVED" | "NEEDS_REVIEW";
  reusedFromApprovedAnswerId: string | null;
  reuseMatchType: "EXACT" | "SEMANTIC" | null;
  reusedAt: string | null;
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

type QuestionRailItem = {
  id: string;
  rowIndex: number;
  textPreview: string;
  reviewStatus: QuestionRow["reviewStatus"];
  notFound: boolean;
  reuseMatchType: QuestionRow["reuseMatchType"];
};

type AutofillPayload = {
  totalCount?: number;
  answeredCount?: number;
  notFoundCount?: number;
  error?: unknown;
};

type EmbedPayload = {
  embeddedCount?: number;
  error?: unknown;
};

type AutofillProgressState = {
  answeredCount: number;
  totalCount: number;
};

type ApproveReusedPayload = {
  approvedCount?: number;
  skippedCount?: number;
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

function normalizedTextForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripLeadingQuestionEcho(answerText: string, questionText: string): string {
  const trimmedAnswer = answerText.trim();
  if (!trimmedAnswer) {
    return "";
  }

  const lines = trimmedAnswer.split(/\r?\n/).map((line) => line.trim());
  const nonEmptyLines = lines.filter((line) => line.length > 0);
  if (nonEmptyLines.length === 0) {
    return "";
  }

  const normalizedQuestion = normalizedTextForCompare(questionText);
  if (!normalizedQuestion) {
    return trimmedAnswer;
  }

  const firstLine = nonEmptyLines[0];
  const normalizedFirstLine = normalizedTextForCompare(firstLine.replace(/^q(uestion)?\s*[:\-]\s*/i, ""));
  if (normalizedFirstLine === normalizedQuestion) {
    const remaining = nonEmptyLines.slice(1).join("\n").trim();
    if (remaining.length > 0) {
      return remaining.replace(/^a(nswer)?\s*[:\-]\s*/i, "").trim();
    }
  }

  const answerWithoutInlinePrefix = trimmedAnswer.replace(/^q(uestion)?\s*[:\-]\s*/i, "").trim();
  const inlineLower = answerWithoutInlinePrefix.toLowerCase();
  if (inlineLower.startsWith(normalizedQuestion)) {
    const afterQuestion = answerWithoutInlinePrefix.slice(normalizedQuestion.length).trim();
    if (afterQuestion.length > 0) {
      return afterQuestion.replace(/^a(nswer)?\s*[:\-]\s*/i, "").trim();
    }
  }

  return trimmedAnswer;
}

function getReuseBadgeLabel(reuseMatchType: QuestionRow["reuseMatchType"]): string | null {
  if (reuseMatchType === "EXACT") {
    return "Reused (exact)";
  }

  if (reuseMatchType === "SEMANTIC") {
    return "Reused (semantic)";
  }

  return null;
}

function getReuseBadgeTone(reuseMatchType: QuestionRow["reuseMatchType"]): "approved" | "review" | null {
  if (reuseMatchType === "EXACT") {
    return "approved";
  }

  if (reuseMatchType === "SEMANTIC") {
    return "review";
  }

  return null;
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

function toQuestionPreview(questionText: string): string {
  const normalized = questionText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No question text";
  }

  return normalized;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 9.5C9 8.12 10.12 7 11.5 7H19.5C20.88 7 22 8.12 22 9.5V17.5C22 18.88 20.88 20 19.5 20H11.5C10.12 20 9 18.88 9 17.5V9.5ZM11.5 8.5C10.95 8.5 10.5 8.95 10.5 9.5V17.5C10.5 18.05 10.95 18.5 11.5 18.5H19.5C20.05 18.5 20.5 18.05 20.5 17.5V9.5C20.5 8.95 20.05 8.5 19.5 8.5H11.5ZM2 6.5C2 5.12 3.12 4 4.5 4H13.5V5.5H4.5C3.95 5.5 3.5 5.95 3.5 6.5V15.5C3.5 16.05 3.95 16.5 4.5 16.5H8V18H4.5C3.12 18 2 16.88 2 15.5V6.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function OpenDocIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 4H20V10H18.5V6.56L11.03 14.03L9.97 12.97L17.44 5.5H14V4ZM5.5 5.5H10V7H5.5C4.95 7 4.5 7.45 4.5 8V18C4.5 18.55 4.95 19 5.5 19H15.5C16.05 19 16.5 18.55 16.5 18V13.5H18V18C18 19.38 16.88 20.5 15.5 20.5H5.5C4.12 20.5 3 19.38 3 18V8C3 6.62 4.12 5.5 5.5 5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SnippetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 5.5C4 4.12 5.12 3 6.5 3H17.5C18.88 3 20 4.12 20 5.5V14.5C20 15.88 18.88 17 17.5 17H9.62L5.53 20.77C5.09 21.17 4.4 20.86 4.4 20.26V17C4.17 16.96 3.95 16.88 3.75 16.75C3.28 16.44 3 15.92 3 15.36V5.5H4ZM6.5 4.5C5.95 4.5 5.5 4.95 5.5 5.5V14.5C5.5 15.05 5.95 15.5 6.5 15.5H9.92L18.5 15.5C19.05 15.5 19.5 15.05 19.5 14.5V5.5C19.5 4.95 19.05 4.5 18.5 4.5H6.5ZM8 8.25H17V9.75H8V8.25ZM8 11.25H14.5V12.75H8V11.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function EvidencePackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 3H14.5L19 7.5V19C19 20.1 18.1 21 17 21H5.5C4.4 21 3.5 20.1 3.5 19V5C3.5 3.9 4.4 3 5.5 3ZM14 4.5V8H17.5L14 4.5ZM5.5 4.5C5.23 4.5 5 4.73 5 5V19C5 19.27 5.23 19.5 5.5 19.5H17C17.27 19.5 17.5 19.27 17.5 19V9.5H13.5C12.95 9.5 12.5 9.05 12.5 8.5V4.5H5.5ZM7 12H15V13.5H7V12ZM7 15H13V16.5H7V15Z"
        fill="currentColor"
      />
    </svg>
  );
}

const QuestionRailItemButton = memo(function QuestionRailItemButton({
  item,
  active,
  onSelect
}: {
  item: QuestionRailItem;
  active: boolean;
  onSelect: (questionId: string) => void;
}) {
  return (
    <button
      type="button"
      className={cx("question-list-item", active && "active")}
      onClick={() => onSelect(item.id)}
      title={`Row ${item.rowIndex + 1}`}
      aria-label={`Select question row ${item.rowIndex + 1}`}
    >
      <div className="card-title-row" style={{ marginBottom: 8 }}>
        <span className="small muted">Row {item.rowIndex + 1}</span>
        <div className="toolbar-row compact">
          <Badge tone={statusTone(item.reviewStatus)} title={statusLabel(item.reviewStatus)}>
            {statusLabel(item.reviewStatus)}
          </Badge>
          {item.reuseMatchType ? (
            <Badge tone={getReuseBadgeTone(item.reuseMatchType) ?? "draft"}>
              {getReuseBadgeLabel(item.reuseMatchType)}
            </Badge>
          ) : null}
          {item.notFound ? <Badge tone="notfound">Not found</Badge> : null}
        </div>
      </div>
      <div className="question-preview-text">{item.textPreview}</div>
    </button>
  );
});

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
  const [autofillProgress, setAutofillProgress] = useState<AutofillProgressState | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isBulkConfirmOpen, setIsBulkConfirmOpen] = useState(false);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isApprovingReusedExact, setIsApprovingReusedExact] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [documentIdByName, setDocumentIdByName] = useState<Record<string, string>>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [documentModalTitle, setDocumentModalTitle] = useState("");
  const [documentModalText, setDocumentModalText] = useState("");
  const [documentModalError, setDocumentModalError] = useState("");
  const evidencePanelRef = useRef<HTMLDivElement | null>(null);
  const bulkModalRef = useRef<HTMLDivElement | null>(null);
  const shortcutsModalRef = useRef<HTMLDivElement | null>(null);
  const documentModalRef = useRef<HTMLDivElement | null>(null);
  const deferredSearchText = useDeferredValue(searchText);

  const loadDetails = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) {
        setIsLoading(true);
        setMessage("");
      }

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
          updatedAt: typeof question.updatedAt === "string" ? question.updatedAt : new Date(0).toISOString(),
          reusedFromApprovedAnswerId:
            typeof question.reusedFromApprovedAnswerId === "string" && question.reusedFromApprovedAnswerId.trim().length > 0
              ? question.reusedFromApprovedAnswerId
              : null,
          reuseMatchType:
            question.reuseMatchType === "EXACT" || question.reuseMatchType === "SEMANTIC"
              ? question.reuseMatchType
              : null,
          reusedAt:
            typeof question.reusedAt === "string" && question.reusedAt.trim().length > 0 ? question.reusedAt : null,
          approvedAnswer: normalizeApprovedAnswer(question.approvedAnswer)
        }));

        const normalizedPayload: QuestionnaireDetailsPayload = {
          questionnaire: payload.questionnaire,
          questions: normalizedQuestions
        };

        setData(normalizedPayload);
        return normalizedPayload;
      } catch (error) {
        if (!silent) {
          setMessage(error instanceof Error ? error.message : "Failed to load questionnaire");
          setData(null);
        }
        return null;
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [questionnaireId]
  );

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

    const loweredSearch = deferredSearchText.trim().toLowerCase();
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
  }, [data, deferredSearchText, filter, questionOrder, questionsById]);

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

  const handleSelectQuestion = useCallback((questionId: string) => {
    setSelectedQuestionId(questionId);
  }, []);

  const railItems = useMemo<QuestionRailItem[]>(() => {
    return filteredQuestionIds
      .map((questionId) => {
        const question = questionsById[questionId];
        if (!question) {
          return null;
        }

        return {
          id: question.id,
          rowIndex: question.rowIndex,
          textPreview: toQuestionPreview(question.text),
          reviewStatus: question.reviewStatus,
          notFound: isNotFoundAnswer(question.answer),
          reuseMatchType: question.reuseMatchType
        };
      })
      .filter((item): item is QuestionRailItem => Boolean(item));
  }, [filteredQuestionIds, questionsById]);

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

  const exactReusedEligibleQuestions = useMemo(() => {
    return (data?.questions ?? []).filter((question) => {
      if (question.reviewStatus === "APPROVED") {
        return false;
      }

      if (question.reuseMatchType !== "EXACT" || !question.reusedFromApprovedAnswerId) {
        return false;
      }

      return !isNotFoundAnswer(question.answer) && extractCitationChunkIds(question).length > 0;
    });
  }, [data?.questions]);

  const approvedProgress = useMemo(() => {
    if (statusCounts.ALL === 0) {
      return 0;
    }

    return Math.round((statusCounts.APPROVED / statusCounts.ALL) * 100);
  }, [statusCounts]);

  const autofillProgressPercent = useMemo(() => {
    const totalCount = Number(autofillProgress?.totalCount ?? 0);
    if (totalCount <= 0) {
      return 0;
    }

    const answeredCount = Number(autofillProgress?.answeredCount ?? 0);
    return Math.max(0, Math.min(100, Math.round((answeredCount / totalCount) * 100)));
  }, [autofillProgress]);

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
    const runStartedAtMs = Date.now();
    const totalCount = data?.questionnaire.questionCount ?? 0;
    setAutofillProgress({
      answeredCount: 0,
      totalCount
    });

    let pollTimer: number | null = null;
    let pollInFlight = false;
    let pollingStopped = false;
    const pollDetails = async () => {
      if (pollInFlight || pollingStopped) {
        return null;
      }

      pollInFlight = true;
      try {
        const latest = await loadDetails({ silent: true });
        if (latest) {
          const processedCount = latest.questions.reduce((count, question) => {
            const updatedAtMs = Number.isNaN(Date.parse(question.updatedAt))
              ? 0
              : new Date(question.updatedAt).getTime();
            return updatedAtMs >= runStartedAtMs ? count + 1 : count;
          }, 0);
          setAutofillProgress({
            answeredCount: Math.max(0, Math.min(totalCount, processedCount)),
            totalCount
          });
        }
        return latest;
      } finally {
        pollInFlight = false;
      }
    };

    try {
      pollTimer = window.setInterval(() => {
        void pollDetails();
      }, 1000);

      const embedResponse = await fetch("/api/documents/embed", {
        method: "POST"
      });
      const embedPayload = (await embedResponse.json().catch(() => ({}))) as EmbedPayload;
      if (!embedResponse.ok) {
        throw new Error(
          `Embedding step failed: ${getApiErrorMessage(embedPayload, "Failed to embed document chunks.")}`
        );
      }

      const response = await fetch(`/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      });
      const payload = (await response.json()) as AutofillPayload;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Autofill failed."));
      }

      const latest = await pollDetails();
      setAutofillProgress({
        answeredCount: totalCount,
        totalCount
      });
      const embeddedCount = Number(embedPayload.embeddedCount ?? 0);
      const embeddingPrefix =
        embeddedCount > 0 ? `Embedded ${embeddedCount} pending chunk${embeddedCount === 1 ? "" : "s"}. ` : "";
      const answeredCount = latest?.questionnaire.answeredCount ?? payload.answeredCount ?? 0;
      const finalTotalCount = latest?.questionnaire.questionCount ?? payload.totalCount ?? 0;
      const notFoundCount = latest?.questionnaire.notFoundCount ?? payload.notFoundCount ?? 0;
      setMessage(
        `${embeddingPrefix}Autofill complete: ${answeredCount}/${finalTotalCount} answered, ${notFoundCount} not found.`
      );
    } catch (error) {
      setMessage(`Autofill failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      pollingStopped = true;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      await loadDetails({ silent: true });
      setIsRunningAutofill(false);
      setAutofillProgress(null);
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

  async function approveExactReusedQuestions() {
    if (exactReusedEligibleQuestions.length === 0) {
      setMessage("No exact reused questions are eligible for approval.");
      return;
    }

    setMessage("");
    setIsApprovingReusedExact(true);

    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}/approve-reused`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "exactOnly"
        })
      });
      const payload = (await response.json()) as ApproveReusedPayload;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to approve reused exact questions."));
      }

      const approvedCount = Number(payload.approvedCount ?? 0);
      const skippedCount = Number(payload.skippedCount ?? 0);
      setMessage(
        skippedCount > 0
          ? `Approved ${approvedCount} reused exact question${approvedCount === 1 ? "" : "s"}. Skipped ${skippedCount}.`
          : `Approved ${approvedCount} reused exact question${approvedCount === 1 ? "" : "s"}.`
      );
      await loadDetails();
    } catch (error) {
      setMessage(`Approve reused exact failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setIsApprovingReusedExact(false);
    }
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

  useFocusTrap({
    active: isBulkConfirmOpen,
    containerRef: bulkModalRef,
    onEscape: () => setIsBulkConfirmOpen(false)
  });

  useFocusTrap({
    active: isShortcutsOpen,
    containerRef: shortcutsModalRef,
    onEscape: () => setIsShortcutsOpen(false)
  });

  useFocusTrap({
    active: isDocumentModalOpen,
    containerRef: documentModalRef,
    onEscape: closeDocumentModal
  });

  const activeEvidence = evidenceItems.find((item) => item.chunkId === activeEvidenceChunkId) ?? null;
  const generatedAnswerRaw = (selectedQuestion?.answer ?? "").trim();
  const approvedAnswerRaw = (selectedQuestion?.approvedAnswer?.answerText ?? "").trim();
  const generatedAnswer =
    stripLeadingQuestionEcho(generatedAnswerRaw, selectedQuestion?.text ?? "") || "Not answered yet.";
  const approvedAnswer = stripLeadingQuestionEcho(approvedAnswerRaw, selectedQuestion?.text ?? "");
  const showingGeneratedComparison = Boolean(selectedQuestion?.approvedAnswer) && showGeneratedDraft;
  const effectiveAnswer = showingGeneratedComparison ? generatedAnswer : approvedAnswer || generatedAnswer;
  const citationReferenceRows = useMemo(
    () => evidenceItems.map((item) => `${item.docName}#${item.chunkId}`),
    [evidenceItems]
  );
  const citationReferenceText = useMemo(() => citationReferenceRows.join("\n"), [citationReferenceRows]);
  const selectedCitationReference = activeEvidence ? `${activeEvidence.docName}#${activeEvidence.chunkId}` : "";
  const evidencePackText = useMemo(() => {
    const lines = [
      "Answer:",
      effectiveAnswer,
      "",
      "Citations:",
      citationReferenceText || "None"
    ];

    if (activeEvidence?.snippet) {
      lines.push("", `Selected citation: ${selectedCitationReference}`, "Selected snippet:", activeEvidence.snippet);
    }

    return lines.join("\n");
  }, [activeEvidence?.snippet, citationReferenceText, effectiveAnswer, selectedCitationReference]);
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

      if (key === "a" && selectedQuestion && selectedQuestionApprovalCandidate && !isBulkApproving && !isApprovingReusedExact) {
        event.preventDefault();
        void approveQuestion(selectedQuestion);
        return;
      }

      if (
        key === "r" &&
        selectedQuestion &&
        !isBulkApproving &&
        !isApprovingReusedExact &&
        selectedQuestion.reviewStatus !== "NEEDS_REVIEW"
      ) {
        event.preventDefault();
        void updateReviewStatus(selectedQuestion.id, "NEEDS_REVIEW");
        return;
      }

      if (key === "u" && selectedQuestion?.approvedAnswer && !isBulkApproving && !isApprovingReusedExact) {
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
    isApprovingReusedExact,
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
              disabled={isLoading || isBulkApproving || isApprovingReusedExact || bulkEligibleQuestions.length === 0}
              title="Approve all currently visible eligible questions"
              aria-label="Approve visible eligible questions"
            >
              {isBulkApproving ? "Approving..." : `Approve Visible (${bulkEligibleQuestions.length})`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void approveExactReusedQuestions()}
              disabled={
                isLoading ||
                isBulkApproving ||
                isApprovingReusedExact ||
                isRunningAutofill ||
                exactReusedEligibleQuestions.length === 0
              }
              title="Approve only exact-match reused answers with valid citations"
              aria-label="Approve reused exact answers"
            >
              {isApprovingReusedExact
                ? "Approving reused..."
                : `Approve Reused (Exact) (${exactReusedEligibleQuestions.length})`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="btn-progress"
              onClick={() => void runAutofill()}
              disabled={isRunningAutofill || isBulkApproving || isApprovingReusedExact}
              title="Run autofill for this questionnaire"
              aria-label="Run autofill for questionnaire"
            >
              {isRunningAutofill ? (
                <span className="btn-progress-content" aria-live="polite">
                  <span className="btn-progress-track" aria-hidden="true">
                    <span className="btn-progress-fill" style={{ width: `${autofillProgressPercent}%` }} />
                  </span>
                  <span className="btn-progress-label">
                    Running {autofillProgress?.answeredCount ?? 0}/{autofillProgress?.totalCount ?? 0}
                  </span>
                </span>
              ) : (
                "Run Autofill"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsExportModalOpen(true)}
              aria-label="Export questionnaire CSV"
              title="Export questionnaire CSV"
            >
              Export
            </Button>
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
            <div className="small muted" id="approved-progress-label">
              Approved progress
            </div>
            <div
              className="trust-progress-track"
              role="progressbar"
              aria-label="Approved progress"
              aria-labelledby="approved-progress-label"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={approvedProgress}
              aria-valuetext={`${approvedProgress}% approved`}
            >
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
        <div className="workbench-grid" data-testid="questionnaire-workbench">
        <Card className="sticky-panel" data-testid="question-rail-panel">
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
                aria-label={`Filter questions by ${label.toLowerCase()}`}
              >
                {label} ({statusCounts[key]})
              </button>
            ))}
          </div>

          <div className="question-list" style={{ marginTop: 12 }}>
            {railItems.length === 0 ? (
              <div className="muted small">No questions match the current filters.</div>
            ) : (
              railItems.map((item) => (
                <QuestionRailItemButton
                  key={item.id}
                  item={item}
                  active={selectedQuestionId === item.id}
                  onSelect={handleSelectQuestion}
                />
              ))
            )}
          </div>
        </Card>

        <Card data-testid="answer-main-panel">
          {selectedQuestion ? (
            <>
              <div className="card-title-row">
                <div>
                  <h3 style={{ marginBottom: 6 }}>Question</h3>
                  <div className="toolbar-row compact">
                    <Badge tone={statusTone(selectedQuestion.reviewStatus)} title={statusLabel(selectedQuestion.reviewStatus)}>
                      {statusLabel(selectedQuestion.reviewStatus)}
                    </Badge>
                    {selectedQuestion.reuseMatchType ? (
                      <Badge tone={getReuseBadgeTone(selectedQuestion.reuseMatchType) ?? "draft"}>
                        {getReuseBadgeLabel(selectedQuestion.reuseMatchType)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <span className="small muted">Row {selectedQuestion.rowIndex + 1}</span>
              </div>

              <Card className="card-muted">
                <p className="workbench-question-text" style={{ margin: 0 }}>
                  {selectedQuestion.text || "No question text available."}
                </p>
                {selectedQuestion.reuseMatchType ? (
                  <p className="small muted" style={{ margin: "8px 0 0" }}>
                    {getReuseBadgeLabel(selectedQuestion.reuseMatchType)}
                    {selectedQuestion.reusedAt ? ` at ${new Date(selectedQuestion.reusedAt).toLocaleString()}` : ""}
                  </p>
                ) : null}
              </Card>

              <Card style={{ marginTop: 12 }}>
                <div className="card-title-row">
                  <h3 style={{ margin: 0 }}>
                    {selectedQuestion.approvedAnswer && !showingGeneratedComparison ? "Approved Answer" : "Generated Draft"}
                  </h3>
                  <div className="toolbar-row" style={{ flexWrap: "nowrap", gap: 8 }}>
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
                      activeQuestionActionId === selectedQuestion.id ||
                      isBulkApproving ||
                      isApprovingReusedExact ||
                      !selectedQuestionApprovalCandidate
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
                      isApprovingReusedExact ||
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
                      isApprovingReusedExact ||
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
                    disabled={
                      activeQuestionActionId === selectedQuestion.id ||
                      isBulkApproving ||
                      isApprovingReusedExact ||
                      !selectedQuestion.approvedAnswer
                    }
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
                            disabled={
                              activeQuestionActionId === selectedQuestion.id ||
                              isBulkApproving ||
                              isApprovingReusedExact
                            }
                          >
                            Save approved edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={isBulkApproving || isApprovingReusedExact}
                          >
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

        <Card className="workbench-evidence sticky-panel" data-testid="evidence-panel">
          <div ref={evidencePanelRef} tabIndex={0} className="focus-target" role="region" aria-label="Evidence panel">
            <div className="evidence-header">
              <h3 style={{ margin: 0 }}>Evidence ({evidenceItems.length})</h3>
              <div className="evidence-toolbar">
                <button
                  type="button"
                  className="evidence-copy-refs-btn"
                  onClick={() => void copyText(citationReferenceText, "Citation references copied.")}
                  disabled={citationReferenceRows.length === 0}
                  title="Copy refs"
                  aria-label="Copy refs"
                >
                  Copy refs
                </button>
                <button
                  type="button"
                  className="mini-chip-icon-action has-tooltip tooltip-below"
                  onClick={() => void copyText(activeEvidence?.snippet ?? "", "Selected snippet copied.")}
                  disabled={!activeEvidence?.snippet}
                  title="Copy selected snippet"
                  data-tooltip="Copy selected snippet"
                  aria-label="Copy selected snippet"
                >
                  <SnippetIcon />
                  <span className="sr-only">Copy selected snippet</span>
                </button>
                <button
                  type="button"
                  className="mini-chip-icon-action has-tooltip tooltip-below"
                  onClick={() => void copyText(evidencePackText, "Evidence pack copied.")}
                  disabled={citationReferenceRows.length === 0}
                  title="Copy evidence pack"
                  data-tooltip="Copy evidence pack"
                  aria-label="Copy evidence pack"
                >
                  <EvidencePackIcon />
                  <span className="sr-only">Copy evidence pack</span>
                </button>
              </div>
            </div>

            {evidenceItems.length === 0 ? (
              <div className="muted small">No citations available for the current question.</div>
            ) : (
              <>
                <div className="evidence-chip-list">
                  {evidenceItems.map((item) => {
                    const citationReference = `${item.docName}#${item.chunkId}`;
                    return (
                      <div
                        key={item.chunkId}
                        className={cx("evidence-chip-item", item.chunkId === activeEvidenceChunkId && "active")}
                      >
                        <button
                          type="button"
                          className={cx("chip evidence-chip-trigger has-tooltip", item.chunkId === activeEvidenceChunkId && "active")}
                          onClick={() => setActiveEvidenceChunkId(item.chunkId)}
                          title={citationReference}
                          data-tooltip={citationReference}
                          aria-label={`Select evidence from ${citationReference}`}
                        >
                          <span className="evidence-chip-doc">{item.docName}</span>
                        </button>
                        <div className="evidence-chip-actions">
                          <button
                            type="button"
                            className="mini-chip-icon-action has-tooltip"
                            onClick={() => void copyText(citationReference, "Citation reference copied.")}
                            title="Copy reference"
                            data-tooltip={`Copy ref (${citationReference})`}
                            aria-label={`Copy citation reference ${citationReference}`}
                          >
                            <CopyIcon />
                            <span className="sr-only">Copy reference</span>
                          </button>
                          <button
                            type="button"
                            className="mini-chip-icon-action has-tooltip"
                            onClick={() => void openDocumentModal(item.docName)}
                            title="Open document"
                            data-tooltip="Open document"
                            aria-label={`Open source document ${item.docName}`}
                          >
                            <OpenDocIcon />
                            <span className="sr-only">Open document</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="snippet-scroll" style={{ marginTop: 8 }}>
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
          <div className="overlay-modal-card" ref={bulkModalRef} tabIndex={-1}>
            <h3 style={{ marginTop: 0 }}>Approve Visible Questions</h3>
            <p style={{ margin: "8px 0" }}>
              You are about to approve <strong>{bulkEligibleQuestions.length}</strong> visible questions.
            </p>
            <p className="small muted" style={{ marginTop: 0 }}>
              Only questions with non-NOT_FOUND answers and non-empty citations are eligible.
            </p>
            <div className="toolbar-row">
              <Button
                type="button"
                variant="primary"
                onClick={() => void approveVisibleQuestions()}
                disabled={isBulkApproving || isApprovingReusedExact}
              >
                Confirm Approve Visible
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsBulkConfirmOpen(false)}
                disabled={isBulkApproving || isApprovingReusedExact}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isShortcutsOpen ? (
        <div className="overlay-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <div className="overlay-modal-card" ref={shortcutsModalRef} tabIndex={-1}>
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
          <div className="overlay-modal-card document-modal-card" ref={documentModalRef} tabIndex={-1}>
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

      <ExportModal
        isOpen={isExportModalOpen}
        questionnaireId={questionnaireId}
        questionnaireName={data?.questionnaire.name ?? "questionnaire"}
        onClose={() => setIsExportModalOpen(false)}
        onSuccess={(nextMessage) => setMessage(nextMessage)}
        onError={(nextMessage) => setMessage(nextMessage)}
      />
    </div>
  );
}
