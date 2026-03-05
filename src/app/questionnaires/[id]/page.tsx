"use client";

import { useParams, useRouter } from "next/navigation";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useAppAuthz } from "@/components/AppAuthzContext";
import { ExportModal } from "@/components/ExportModal";
import { Badge, Button, Card, TextArea, TextInput, cx } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { can, RbacAction } from "@/server/rbac";

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

type QuestionFilter = "ALL" | "DRAFT" | "APPROVED" | "NEEDS_REVIEW" | "NOT_FOUND" | "REUSED";
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
  citationCount: number;
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

type DrawerTab = "ANSWER" | "EVIDENCE" | "REFERENCES";

const NOT_FOUND_ANSWER = "Not found in provided documents.";
const FILTER_OPTIONS: Array<{ key: QuestionFilter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "APPROVED", label: "Approved" },
  { key: "NEEDS_REVIEW", label: "Needs review" },
  { key: "NOT_FOUND", label: "Not found" },
  { key: "REUSED", label: "Reused" }
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

function getQueueCitationCount(question: QuestionRow): number {
  if (question.approvedAnswer && question.approvedAnswer.citationChunkIds.length > 0) {
    return question.approvedAnswer.citationChunkIds.filter((chunkId) => chunkId.trim().length > 0).length;
  }

  return extractCitationChunkIds(question).length;
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

function isClickLikeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toUpperCase();
  if (tagName === "BUTTON" || tagName === "A" || tagName === "SUMMARY") {
    return true;
  }

  return target.closest("button, a, summary, [role='button'], [role='menuitem']") !== null;
}

function toQuestionPreview(questionText: string): string {
  const normalized = questionText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No question text";
  }

  return normalized;
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

const QuestionRailItemButton = memo(function QuestionRailItemButton({
  item,
  active,
  onSelect,
  onRegisterRef
}: {
  item: QuestionRailItem;
  active: boolean;
  onSelect: (questionId: string, trigger?: HTMLButtonElement | null) => void;
  onRegisterRef: (questionId: string, node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      className={cx("question-list-item queue-row", active && "active")}
      onClick={(event) => onSelect(item.id, event.currentTarget)}
      ref={(node) => onRegisterRef(item.id, node)}
      data-question-row-id={item.id}
      title={`Row ${item.rowIndex + 1}`}
      aria-label={`Select question row ${item.rowIndex + 1}`}
      role="option"
      aria-selected={active}
    >
      <div className="queue-row-head">
        <div className="toolbar-row compact">
          <span className="small muted">Row {item.rowIndex + 1}</span>
          <Badge tone={statusTone(item.reviewStatus)} title={statusLabel(item.reviewStatus)}>
            {statusLabel(item.reviewStatus)}
          </Badge>
        </div>
        <div className="toolbar-row compact">
          {item.reuseMatchType ? (
            <Badge tone={getReuseBadgeTone(item.reuseMatchType) ?? "draft"}>
              {getReuseBadgeLabel(item.reuseMatchType)}
            </Badge>
          ) : null}
          {item.notFound ? <Badge tone="notfound">Not found</Badge> : null}
          <Badge tone="draft">{item.citationCount} citation{item.citationCount === 1 ? "" : "s"}</Badge>
        </div>
      </div>
      <div className="queue-row-preview">{item.textPreview}</div>
      <div className="queue-row-open" aria-hidden="true">
        Open
      </div>
    </button>
  );
});

export default function QuestionnaireDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const questionnaireId = params.id;
  const { role, orgId } = useAppAuthz();

  const [data, setData] = useState<QuestionnaireDetailsPayload | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<QuestionFilter>("ALL");
  const [searchText, setSearchText] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("ANSWER");
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false);
  const [lastInteractedRowId, setLastInteractedRowId] = useState<string | null>(null);
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
  const [documentIdByName, setDocumentIdByName] = useState<Record<string, string>>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [documentModalTitle, setDocumentModalTitle] = useState("");
  const [documentModalText, setDocumentModalText] = useState("");
  const [documentModalError, setDocumentModalError] = useState("");
  const contextDrawerRef = useRef<HTMLDivElement | null>(null);
  const queueRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const bulkModalRef = useRef<HTMLDivElement | null>(null);
  const documentModalRef = useRef<HTMLDivElement | null>(null);
  const deferredSearchText = useDeferredValue(searchText);
  const canRunAutofill = role ? can(role, RbacAction.RUN_AUTOFILL) : false;
  const canApproveAnswers = role ? can(role, RbacAction.APPROVE_ANSWERS) : false;
  const canEditApprovedAnswers = role ? can(role, RbacAction.EDIT_APPROVED_ANSWERS) : false;
  const canMarkNeedsReview = role ? can(role, RbacAction.MARK_NEEDS_REVIEW) : false;
  const canExportQuestionnaire = role ? can(role, RbacAction.EXPORT) : false;
  const canDeleteQuestionnaire = role ? can(role, RbacAction.DELETE_QUESTIONNAIRES) : false;

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
  }, [orgId, questionnaireId, loadDetails]);

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

      if (filter === "REUSED" && !question.reuseMatchType) {
        return false;
      }

      if (filter !== "ALL" && filter !== "NOT_FOUND" && filter !== "REUSED" && question.reviewStatus !== filter) {
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
      NOT_FOUND: 0,
      REUSED: 0
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
      if (question.reuseMatchType) {
        counts.REUSED += 1;
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

      const nextId = filteredQuestionIds[0];
      setLastInteractedRowId(nextId);
      return nextId;
    });
  }, [filteredQuestionIds]);

  const selectedQuestion = useMemo(
    () => (selectedQuestionId ? questionsById[selectedQuestionId] ?? null : null),
    [questionsById, selectedQuestionId]
  );

  const closeContextDrawer = useCallback(() => {
    setIsContextOpen(false);
    setIsMobileSheetExpanded(false);

    const focusTargetId = lastInteractedRowId ?? selectedQuestionId;
    if (!focusTargetId) {
      return;
    }

    window.requestAnimationFrame(() => {
      queueRowRefs.current[focusTargetId]?.focus();
    });
  }, [lastInteractedRowId, selectedQuestionId]);

  const handleSelectQuestion = useCallback((questionId: string, trigger?: HTMLButtonElement | null) => {
    setSelectedQuestionId(questionId);
    setIsContextOpen(true);
    setDrawerTab("ANSWER");
    setLastInteractedRowId(questionId);

    if (trigger) {
      queueRowRefs.current[questionId] = trigger;
    }
  }, []);

  const registerQueueRowRef = useCallback((questionId: string, node: HTMLButtonElement | null) => {
    queueRowRefs.current[questionId] = node;
  }, []);

  useEffect(() => {
    if (!selectedQuestionId) {
      setIsContextOpen(false);
      setIsMobileSheetExpanded(false);
    }
  }, [selectedQuestionId]);

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (filteredQuestionIds.length === 0) {
        return;
      }

      setSelectedQuestionId((current) => {
        if (!current) {
          const firstId = filteredQuestionIds[0];
          setLastInteractedRowId(firstId);
          return firstId;
        }

        const currentIndex = filteredQuestionIds.indexOf(current);
        if (currentIndex < 0) {
          const firstId = filteredQuestionIds[0];
          setLastInteractedRowId(firstId);
          return firstId;
        }

        const nextIndex = Math.max(0, Math.min(filteredQuestionIds.length - 1, currentIndex + direction));
        const nextId = filteredQuestionIds[nextIndex];
        setLastInteractedRowId(nextId);
        return nextId;
      });
    },
    [filteredQuestionIds]
  );

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
          reuseMatchType: question.reuseMatchType,
          citationCount: getQueueCitationCount(question)
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
    setIsAnswerExpanded(true);
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
    if (!canRunAutofill) {
      setMessage("You do not have permission to run autofill.");
      return;
    }

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
    if (!canApproveAnswers) {
      setMessage("You do not have permission to approve answers.");
      setIsBulkConfirmOpen(false);
      return;
    }

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
    if (!canApproveAnswers) {
      setMessage("You do not have permission to approve reused answers.");
      return;
    }

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
    if (!canApproveAnswers) {
      setMessage("You do not have permission to approve answers.");
      return;
    }

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
  }, [canApproveAnswers, loadDetails, persistApproval]);

  const updateReviewStatus = useCallback(async (questionId: string, reviewStatus: "NEEDS_REVIEW" | "DRAFT") => {
    if (!canMarkNeedsReview) {
      setMessage("You do not have permission to change review status.");
      return;
    }

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
  }, [canMarkNeedsReview, loadDetails]);

  const unapprove = useCallback(async (approvedAnswerId: string, questionId: string) => {
    if (!canApproveAnswers) {
      setMessage("You do not have permission to remove approvals.");
      return;
    }

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
  }, [canApproveAnswers, loadDetails]);

  function beginEdit(question: QuestionRow) {
    if (!canEditApprovedAnswers) {
      setMessage("You do not have permission to edit approved answers.");
      return;
    }

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
    if (!canEditApprovedAnswers) {
      setMessage("You do not have permission to edit approved answers.");
      return;
    }

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

  const deleteQuestionnaire = useCallback(async () => {
    if (!canDeleteQuestionnaire) {
      setMessage("You do not have permission to delete questionnaires.");
      return;
    }

    const confirmed = window.confirm(
      `Delete "${data?.questionnaire.name ?? "this questionnaire"}"? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setMessage("");
    try {
      const response = await fetch(`/api/questionnaires/${questionnaireId}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to delete questionnaire."));
      }

      router.push("/questionnaires");
    } catch (error) {
      setMessage(`Delete failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    }
  }, [canDeleteQuestionnaire, data?.questionnaire.name, questionnaireId, router]);

  useFocusTrap({
    active: isBulkConfirmOpen,
    containerRef: bulkModalRef,
    onEscape: () => setIsBulkConfirmOpen(false)
  });

  useFocusTrap({
    active: isDocumentModalOpen,
    containerRef: documentModalRef,
    onEscape: closeDocumentModal
  });

  useFocusTrap({
    active: isContextOpen && Boolean(selectedQuestion),
    containerRef: contextDrawerRef,
    onEscape: closeContextDrawer
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
  const selectedQuestionCitationCount = selectedQuestion ? getQueueCitationCount(selectedQuestion) : 0;
  const activeEvidenceDocumentId = activeEvidence
    ? documentIdByName[activeEvidence.docName.trim().toLowerCase()] ?? null
    : null;
  const isMessageError = useMemo(() => {
    const normalized = message.toLowerCase();
    return normalized.includes("fail") || normalized.includes("error") || normalized.includes("unable");
  }, [message]);
  const isMessageSuccess = useMemo(() => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("approved") ||
      normalized.includes("updated") ||
      normalized.includes("marked") ||
      normalized.includes("removed") ||
      normalized.includes("complete")
    );
  }, [message]);
  const selectedQuestionApprovalCandidate = selectedQuestion ? getApprovalCandidate(selectedQuestion) : null;
  const hasMissingVisibleAnswers = useMemo(
    () => visibleQuestions.some((question) => (question.answer ?? "").trim().length === 0),
    [visibleQuestions]
  );
  const shouldShowRunAutofillPrimary = useMemo(
    () => (data?.questionnaire.answeredCount ?? 0) === 0 || hasMissingVisibleAnswers,
    [data?.questionnaire.answeredCount, hasMissingVisibleAnswers]
  );
  const primaryAction = useMemo(() => {
    if (shouldShowRunAutofillPrimary && canRunAutofill) {
      return {
        key: "run-autofill" as const,
        label: isRunningAutofill ? "Running Autofill..." : "Run Autofill",
        disabled: isRunningAutofill || isBulkApproving || isApprovingReusedExact
      };
    }

    if (!shouldShowRunAutofillPrimary && canApproveAnswers && exactReusedEligibleQuestions.length > 0) {
      return {
        key: "approve-reused" as const,
        label: isApprovingReusedExact
          ? "Approving reused..."
          : `Approve Reused (Exact) (${exactReusedEligibleQuestions.length})`,
        disabled: isLoading || isRunningAutofill || isBulkApproving || isApprovingReusedExact
      };
    }

    if (canExportQuestionnaire) {
      return {
        key: "export" as const,
        label: "Export",
        disabled: false
      };
    }

    if (canRunAutofill) {
      return {
        key: "run-autofill" as const,
        label: isRunningAutofill ? "Running Autofill..." : "Run Autofill",
        disabled: isRunningAutofill || isBulkApproving || isApprovingReusedExact
      };
    }

    return {
      key: "refresh" as const,
      label: isLoading ? "Refreshing..." : "Refresh",
      disabled: isLoading
    };
  }, [
    canApproveAnswers,
    canExportQuestionnaire,
    canRunAutofill,
    exactReusedEligibleQuestions.length,
    isApprovingReusedExact,
    isBulkApproving,
    isLoading,
    isRunningAutofill,
    shouldShowRunAutofillPrimary
  ]);
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

      if (event.key === "Escape") {
        if (isDocumentModalOpen) {
          event.preventDefault();
          closeDocumentModal();
          return;
        }
        if (isBulkConfirmOpen) {
          event.preventDefault();
          setIsBulkConfirmOpen(false);
          return;
        }
        if (isContextOpen) {
          event.preventDefault();
          closeContextDrawer();
          return;
        }
        return;
      }

      if (isBulkConfirmOpen || isDocumentModalOpen) {
        return;
      }

      if (isContextOpen) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }

      if (event.key === "Enter" && selectedQuestion) {
        if (isClickLikeTarget(event.target)) {
          return;
        }
        event.preventDefault();
        setIsAnswerExpanded((value) => !value);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeDocumentModal,
    closeContextDrawer,
    isBulkConfirmOpen,
    isContextOpen,
    isDocumentModalOpen,
    moveSelection,
    selectedQuestion,
  ]);

  return (
    <div className="page-stack">
      <Card>
        <header className="queue-topbar" aria-label="Review queue header">
          <div>
            <h2 style={{ margin: 0 }}>Review Queue</h2>
            <p className="muted" style={{ margin: 0 }}>
              <strong>{data?.questionnaire.name ?? "Questionnaire"}</strong>
            </p>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Source: {data?.questionnaire.sourceFileName ?? "n/a"} | Question column:{" "}
              {data?.questionnaire.questionColumn ?? "n/a"}
            </p>
          </div>
          <div className="toolbar-row queue-topbar-actions">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (primaryAction.key === "run-autofill") {
                  void runAutofill();
                  return;
                }
                if (primaryAction.key === "approve-reused") {
                  void approveExactReusedQuestions();
                  return;
                }
                if (primaryAction.key === "export") {
                  setIsExportModalOpen(true);
                  return;
                }
                void loadDetails();
              }}
              disabled={primaryAction.disabled}
              aria-label={primaryAction.label}
              title={primaryAction.label}
            >
              {primaryAction.key === "run-autofill" && isRunningAutofill ? (
                <span className="btn-progress-content" aria-live="polite">
                  <span className="btn-progress-track" aria-hidden="true">
                    <span className="btn-progress-fill" style={{ width: `${autofillProgressPercent}%` }} />
                  </span>
                  <span className="btn-progress-label">
                    Running {autofillProgress?.answeredCount ?? 0}/{autofillProgress?.totalCount ?? 0}
                  </span>
                </span>
              ) : (
                primaryAction.label
              )}
            </Button>

            <details className="row-actions-menu topbar-more">
              <summary className="btn btn-ghost row-actions-trigger" aria-label="Open queue actions menu">
                More
              </summary>
              <div className="row-actions-dropdown" role="menu" aria-label="Queue actions">
                {primaryAction.key !== "run-autofill" && canRunAutofill ? (
                  <button
                    type="button"
                    className="row-actions-item"
                    onClick={() => void runAutofill()}
                    disabled={isRunningAutofill || isBulkApproving || isApprovingReusedExact}
                  >
                    {isRunningAutofill ? "Running Autofill..." : "Run Autofill"}
                  </button>
                ) : null}

                {primaryAction.key !== "approve-reused" && canApproveAnswers ? (
                  <button
                    type="button"
                    className="row-actions-item"
                    onClick={() => void approveExactReusedQuestions()}
                    disabled={
                      isLoading ||
                      isBulkApproving ||
                      isApprovingReusedExact ||
                      isRunningAutofill ||
                      exactReusedEligibleQuestions.length === 0
                    }
                  >
                    Approve Reused (Exact) ({exactReusedEligibleQuestions.length})
                  </button>
                ) : null}

                {primaryAction.key !== "export" && canExportQuestionnaire ? (
                  <button
                    type="button"
                    className="row-actions-item"
                    onClick={() => setIsExportModalOpen(true)}
                  >
                    Export...
                  </button>
                ) : null}

                <button
                  type="button"
                  className="row-actions-item"
                  onClick={() => setIsBulkConfirmOpen(true)}
                  disabled={
                    isLoading ||
                    isBulkApproving ||
                    isApprovingReusedExact ||
                    bulkEligibleQuestions.length === 0 ||
                    !canApproveAnswers
                  }
                >
                  Approve Visible ({bulkEligibleQuestions.length})
                </button>

                {primaryAction.key !== "refresh" ? (
                  <button
                    type="button"
                    className="row-actions-item"
                    onClick={() => void loadDetails()}
                    disabled={isLoading}
                  >
                    {isLoading ? "Refreshing..." : "Refresh"}
                  </button>
                ) : null}

                {canDeleteQuestionnaire ? (
                  <button type="button" className="row-actions-item danger" onClick={() => void deleteQuestionnaire()}>
                    Delete questionnaire
                  </button>
                ) : null}
              </div>
            </details>
          </div>
        </header>
      </Card>

      <Card className="trust-bar queue-metrics-strip">
        <div className="queue-metrics-controls">
          <nav className="toolbar-row queue-filter-row" aria-label="Queue filters">
            {FILTER_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={cx("chip", filter === key && "active")}
                onClick={() => setFilter(key)}
                title={`Filter by ${label.toLowerCase()}`}
                aria-label={`Filter questions by ${label.toLowerCase()}`}
                aria-pressed={filter === key}
              >
                {label} ({statusCounts[key]})
              </button>
            ))}
          </nav>
          <div className="queue-search-wrap">
            <TextInput
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search question text or answer preview"
              aria-label="Search question text or answer preview"
            />
          </div>
        </div>
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
      </Card>

      {message ? (
        <div
          className={cx(
            "message-banner",
            isMessageError ? "error" : isMessageSuccess ? "success" : ""
          )}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      ) : null}

      <div className="queue-primary-layout" data-testid="questionnaire-workbench">
        <div data-testid="answer-main-panel">
          <div data-testid="evidence-panel">
            {showLoadingSkeletons ? (
              <Card>
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line" />
                <div className="skeleton-list">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={`rail-skeleton-${index}`} className="skeleton-block" />
                  ))}
                </div>
              </Card>
            ) : (
              <Card data-testid="question-rail-panel">
                <div className="card-title-row">
                  <h3 style={{ margin: 0 }}>Queue</h3>
                  <Badge tone="draft">{filteredQuestionIds.length} visible</Badge>
                </div>

                {!selectedQuestion && railItems.length > 0 ? (
                  <div className="queue-selection-hint" role="status" aria-live="polite">
                    <span className="queue-selection-hint-icon" aria-hidden="true">
                      i
                    </span>
                    Select a question to review
                  </div>
                ) : null}

                <div className="question-list" style={{ marginTop: 12 }} role="listbox" aria-label="Question queue">
                  {railItems.length === 0 ? (
                    <div className="muted small" role="option" aria-disabled="true" aria-selected="false">
                      No questions match the current filters.
                    </div>
                  ) : (
                    railItems.map((item) => (
                      <QuestionRailItemButton
                        key={item.id}
                        item={item}
                        active={selectedQuestionId === item.id}
                        onSelect={handleSelectQuestion}
                        onRegisterRef={registerQueueRowRef}
                      />
                    ))
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {isContextOpen && selectedQuestion ? (
        <div className="context-overlay">
          <button
            type="button"
            className="context-backdrop"
            onClick={closeContextDrawer}
            aria-label="Close question context drawer"
          />
          <div
            className={cx("context-panel", isMobileSheetExpanded && "sheet-expanded")}
            ref={contextDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-drawer-title"
            tabIndex={-1}
          >
            <div className="context-panel-header">
              <div>
                <h3 id="context-drawer-title" style={{ margin: "0 0 4px" }}>
                  Question {selectedQuestion.rowIndex + 1}
                </h3>
                <p className="small muted" style={{ margin: 0 }}>
                  Context review
                </p>
              </div>
              <div className="toolbar-row compact">
                <Button
                  type="button"
                  variant="ghost"
                  className="context-mobile-toggle"
                  onClick={() => setIsMobileSheetExpanded((value) => !value)}
                  title={isMobileSheetExpanded ? "Collapse sheet" : "Expand sheet"}
                >
                  {isMobileSheetExpanded ? "Half" : "Full"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="icon-btn"
                  onClick={closeContextDrawer}
                  aria-label="Close drawer"
                  title="Close"
                >
                  X
                </Button>
              </div>
            </div>

            <div className="context-tablist" role="tablist" aria-label="Question context tabs">
              <button
                type="button"
                role="tab"
                className={cx("context-tab", drawerTab === "ANSWER" && "active")}
                aria-selected={drawerTab === "ANSWER"}
                onClick={() => setDrawerTab("ANSWER")}
              >
                Answer
              </button>
              <button
                type="button"
                role="tab"
                className={cx("context-tab", drawerTab === "EVIDENCE" && "active")}
                aria-selected={drawerTab === "EVIDENCE"}
                onClick={() => setDrawerTab("EVIDENCE")}
              >
                Evidence
              </button>
              <button
                type="button"
                role="tab"
                className={cx("context-tab", drawerTab === "REFERENCES" && "active")}
                aria-selected={drawerTab === "REFERENCES"}
                onClick={() => setDrawerTab("REFERENCES")}
              >
                References
              </button>
            </div>

            <div className="context-panel-body">
              {drawerTab === "ANSWER" ? (
                <div className="context-section-stack">
                  <div className="toolbar-row compact">
                    <Badge tone={statusTone(selectedQuestion.reviewStatus)} title={statusLabel(selectedQuestion.reviewStatus)}>
                      {statusLabel(selectedQuestion.reviewStatus)}
                    </Badge>
                    {selectedQuestion.reuseMatchType ? (
                      <Badge tone={getReuseBadgeTone(selectedQuestion.reuseMatchType) ?? "draft"}>
                        {getReuseBadgeLabel(selectedQuestion.reuseMatchType)}
                      </Badge>
                    ) : null}
                    <Badge tone="draft">
                      {selectedQuestionCitationCount} citation{selectedQuestionCitationCount === 1 ? "" : "s"}
                    </Badge>
                  </div>

                  <Card className="card-muted">
                    <p className="workbench-question-text" style={{ margin: 0 }}>
                      {selectedQuestion.text || "No question text available."}
                    </p>
                  </Card>

                  <div className="card-title-row">
                    <h4 style={{ margin: 0 }}>
                      {selectedQuestion.approvedAnswer && !showingGeneratedComparison ? "Approved Answer" : "Generated Draft"}
                    </h4>
                    <div className="toolbar-row compact">
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
                </div>
              ) : null}

              {drawerTab === "EVIDENCE" ? (
                <div className="context-section-stack">
                  {evidenceItems.length === 0 ? (
                    <div className="muted small">No citations available for the current question.</div>
                  ) : (
                    <>
                      <div className="evidence-chip-list">
                        {evidenceItems.map((item) => {
                          const citationReference = `${item.docName}#${item.chunkId}`;
                          const itemDocumentId = documentIdByName[item.docName.trim().toLowerCase()] ?? null;
                          return (
                            <div
                              key={item.chunkId}
                              className={cx("evidence-chip-item", item.chunkId === activeEvidenceChunkId && "active")}
                            >
                              <button
                                type="button"
                                className={cx(
                                  "chip evidence-chip-trigger has-tooltip",
                                  item.chunkId === activeEvidenceChunkId && "active"
                                )}
                                onClick={() => setActiveEvidenceChunkId(item.chunkId)}
                                title={citationReference}
                                data-tooltip={citationReference}
                                aria-label={`Select evidence from ${citationReference}`}
                              >
                                <span className="evidence-chip-doc">{item.docName}</span>
                              </button>
                              <div className="evidence-chip-actions">
                                {itemDocumentId ? (
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
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="toolbar-row compact">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void copyText(activeEvidence?.snippet ?? "", "Selected snippet copied.")}
                          disabled={!activeEvidence?.snippet}
                        >
                          Copy snippet
                        </Button>
                        {activeEvidenceDocumentId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void openDocumentModal(activeEvidence?.docName ?? "")}
                          >
                            Open document
                          </Button>
                        ) : null}
                      </div>
                      <div className="snippet-scroll">
                        {activeEvidence ? highlightedSnippetParts : "Select a citation chip to view snippet text."}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {drawerTab === "REFERENCES" ? (
                <div className="context-section-stack">
                  <div className="toolbar-row">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void copyText(citationReferenceText, "Citation references copied.")}
                      disabled={citationReferenceRows.length === 0}
                    >
                      Copy all refs
                    </Button>
                  </div>
                  {citationReferenceRows.length === 0 ? (
                    <div className="muted small">No references available for the current question.</div>
                  ) : (
                    <div className="context-reference-list">
                      {citationReferenceRows.map((reference) => (
                        <div key={reference} className="context-reference-item">
                          <span>{reference}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void copyText(reference, "Citation reference copied.")}
                          >
                            Copy ref
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="context-panel-actions">
              {isMessageError ? (
                <div className="message-banner error" role="status" aria-live="polite">
                  {message}
                </div>
              ) : null}
              {isNotFoundAnswer(selectedQuestion.answer) ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Approve is disabled because this question is currently marked as not found.
                </p>
              ) : null}
              <div className="toolbar-row">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void approveQuestion(selectedQuestion)}
                  disabled={
                    activeQuestionActionId === selectedQuestion.id ||
                    isBulkApproving ||
                    isApprovingReusedExact ||
                    !selectedQuestionApprovalCandidate ||
                    !canApproveAnswers
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
                    selectedQuestion.reviewStatus === "NEEDS_REVIEW" ||
                    !canMarkNeedsReview
                  }
                  aria-label="Mark selected question as needs review"
                >
                  Needs review
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
                    !selectedQuestion.approvedAnswer ||
                    !canApproveAnswers
                  }
                  aria-label="Remove selected approval"
                >
                  Unapprove
                </Button>
                {selectedQuestion.approvedAnswer && editingQuestionId !== selectedQuestion.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => beginEdit(selectedQuestion)}
                    disabled={!canEditApprovedAnswers}
                  >
                    Edit approved
                  </Button>
                ) : null}
              </div>

              {selectedQuestion.approvedAnswer && editingQuestionId === selectedQuestion.id ? (
                <div className="context-edit-area">
                  <TextArea rows={5} value={editAnswerText} onChange={(event) => setEditAnswerText(event.target.value)} />
                  <p className="small muted" style={{ margin: "8px 0 0" }}>
                    Citations are preserved from the current approved answer.
                  </p>
                  <div className="toolbar-row">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void saveEditedApproval(selectedQuestion)}
                      disabled={
                        activeQuestionActionId === selectedQuestion.id ||
                        isBulkApproving ||
                        isApprovingReusedExact ||
                        !canEditApprovedAnswers
                      }
                    >
                      Save approved edit
                    </Button>
                    <Button type="button" variant="ghost" onClick={cancelEdit} disabled={isBulkApproving || isApprovingReusedExact}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

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
        isOpen={isExportModalOpen && canExportQuestionnaire}
        questionnaireId={questionnaireId}
        questionnaireName={data?.questionnaire.name ?? "questionnaire"}
        onClose={() => setIsExportModalOpen(false)}
        onSuccess={(nextMessage) => setMessage(nextMessage)}
        onError={(nextMessage) => setMessage(nextMessage)}
      />
    </div>
  );
}
