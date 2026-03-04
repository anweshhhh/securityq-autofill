"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppAuthz } from "@/components/AppAuthzContext";
import { Badge, Button, Card, cx } from "@/components/ui";
import { can, RbacAction } from "@/server/rbac";

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

type QuestionReviewRow = {
  reviewStatus: "DRAFT" | "APPROVED" | "NEEDS_REVIEW";
  approvedAnswer: { id: string } | null;
};

type QuestionnaireDetailsPayload = {
  questions?: QuestionReviewRow[];
  error?: unknown;
};

type DocumentsPayload = {
  documents?: Array<{ id: string }>;
  error?: unknown;
};

type QuestionnaireListPayload = {
  questionnaires?: QuestionnaireRow[];
  error?: unknown;
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

type LoadState = "loading" | "ready" | "unavailable";

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const typed = payload as { error?: unknown };
  if (typeof typed.error === "string" && typed.error.trim()) {
    return typed.error.trim();
  }

  if (typed.error && typeof typed.error === "object" && !Array.isArray(typed.error)) {
    const nested = typed.error as { message?: unknown };
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
  }

  return fallback;
}

function byMostRecentlyUpdated(a: QuestionnaireRow, b: QuestionnaireRow): number {
  const aTime = Date.parse(a.updatedAt || a.createdAt);
  const bTime = Date.parse(b.updatedAt || b.createdAt);
  return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
}

function formatUpdatedAt(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "n/a";
  }
  return new Date(parsed).toLocaleString();
}

function getMessageTone(message: string): "approved" | "review" | "notfound" {
  const normalized = message.toLowerCase();
  if (normalized.includes("failed") || normalized.includes("error") || normalized.includes("unable")) {
    return "notfound";
  }

  if (
    normalized.includes("complete") ||
    normalized.includes("imported") ||
    normalized.includes("success") ||
    normalized.includes("updated")
  ) {
    return "approved";
  }

  return "review";
}

export default function Home() {
  const router = useRouter();
  const { role } = useAppAuthz();
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireRow[]>([]);
  const [documentsCount, setDocumentsCount] = useState<number | null>(null);
  const [questionnairesState, setQuestionnairesState] = useState<LoadState>("loading");
  const [documentsState, setDocumentsState] = useState<LoadState>("loading");
  const [pendingReviewCount, setPendingReviewCount] = useState<number | null>(null);
  const [approvedReusableCount, setApprovedReusableCount] = useState<number | null>(null);
  const [derivedCountsState, setDerivedCountsState] = useState<LoadState>("loading");
  const [isDashboardRefreshing, setIsDashboardRefreshing] = useState(false);
  const [activeAutofillId, setActiveAutofillId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const canRunAutofill = role ? can(role, RbacAction.RUN_AUTOFILL) : false;
  const canImportQuestionnaires = role ? can(role, RbacAction.IMPORT_QUESTIONNAIRES) : false;
  const canInviteMembers = role ? can(role, RbacAction.INVITE_MEMBERS) : false;

  const sortedQuestionnaires = useMemo(() => {
    return [...questionnaires].sort(byMostRecentlyUpdated);
  }, [questionnaires]);

  const mostRecentQuestionnaire = sortedQuestionnaires[0] ?? null;
  const recentQuestionnaires = sortedQuestionnaires.slice(0, 8);
  const questionnaireCount = sortedQuestionnaires.length;
  const isFirstRun =
    questionnairesState === "ready" &&
    documentsState === "ready" &&
    questionnaireCount === 0 &&
    documentsCount === 0;

  const snapshotCards = useMemo(() => {
    const cards: Array<{ key: string; label: string; value: number }> = [];

    if (documentsState === "ready" && documentsCount !== null) {
      cards.push({
        key: "documents",
        label: "Documents",
        value: documentsCount
      });
    }

    if (questionnairesState === "ready") {
      cards.push({
        key: "questionnaires",
        label: "Questionnaires",
        value: questionnaireCount
      });
    }

    if (derivedCountsState === "ready" && pendingReviewCount !== null) {
      cards.push({
        key: "pending-review",
        label: "Pending Review",
        value: pendingReviewCount
      });
    }

    if (derivedCountsState === "ready" && approvedReusableCount !== null) {
      cards.push({
        key: "approved-reusable",
        label: "Approved Reusable Answers",
        value: approvedReusableCount
      });
    }

    return cards;
  }, [
    approvedReusableCount,
    derivedCountsState,
    documentsCount,
    documentsState,
    pendingReviewCount,
    questionnaireCount,
    questionnairesState
  ]);

  const fetchQuestionnaires = useCallback(async () => {
    setQuestionnairesState("loading");

    try {
      const response = await fetch("/api/questionnaires", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as QuestionnaireListPayload;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to load questionnaires."));
      }

      setQuestionnaires(payload.questionnaires ?? []);
      setQuestionnairesState("ready");
    } catch {
      setQuestionnaires([]);
      setQuestionnairesState("unavailable");
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    setDocumentsState("loading");

    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as DocumentsPayload;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to load documents."));
      }

      setDocumentsCount(Array.isArray(payload.documents) ? payload.documents.length : 0);
      setDocumentsState("ready");
    } catch {
      setDocumentsCount(null);
      setDocumentsState("unavailable");
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    setIsDashboardRefreshing(true);
    await Promise.all([fetchQuestionnaires(), fetchDocuments()]);
    setIsDashboardRefreshing(false);
  }, [fetchDocuments, fetchQuestionnaires]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    let cancelled = false;

    async function computeDerivedCounts() {
      if (questionnairesState !== "ready") {
        setPendingReviewCount(null);
        setApprovedReusableCount(null);
        setDerivedCountsState(questionnairesState === "loading" ? "loading" : "unavailable");
        return;
      }

      if (questionnaires.length === 0) {
        setPendingReviewCount(0);
        setApprovedReusableCount(0);
        setDerivedCountsState("ready");
        return;
      }

      setDerivedCountsState("loading");

      try {
        const responses = await Promise.all(
          questionnaires.map((questionnaire) => fetch(`/api/questionnaires/${questionnaire.id}`, { cache: "no-store" }))
        );

        if (responses.some((response) => !response.ok)) {
          throw new Error("Unable to compute derived metrics.");
        }

        const payloads = (await Promise.all(
          responses.map((response) => response.json())
        )) as QuestionnaireDetailsPayload[];

        let pending = 0;
        let approved = 0;

        for (const payload of payloads) {
          for (const question of payload.questions ?? []) {
            if (question.reviewStatus === "DRAFT" || question.reviewStatus === "NEEDS_REVIEW") {
              pending += 1;
            }
            if (question.approvedAnswer) {
              approved += 1;
            }
          }
        }

        if (!cancelled) {
          setPendingReviewCount(pending);
          setApprovedReusableCount(approved);
          setDerivedCountsState("ready");
        }
      } catch {
        if (!cancelled) {
          setPendingReviewCount(null);
          setApprovedReusableCount(null);
          setDerivedCountsState("unavailable");
        }
      }
    }

    void computeDerivedCounts();

    return () => {
      cancelled = true;
    };
  }, [questionnaires, questionnairesState]);

  async function runAutofill(questionnaireId: string) {
    if (!canRunAutofill) {
      setMessage("You do not have permission to run autofill.");
      return;
    }

    setActiveAutofillId(questionnaireId);
    setMessage("");

    try {
      const embedResponse = await fetch("/api/documents/embed", {
        method: "POST"
      });
      const embedPayload = (await embedResponse.json().catch(() => ({}))) as EmbedPayload;

      if (!embedResponse.ok) {
        throw new Error(getApiErrorMessage(embedPayload, "Failed to embed document chunks."));
      }

      const autofillResponse = await fetch(`/api/questionnaires/${questionnaireId}/autofill`, {
        method: "POST"
      });
      const autofillPayload = (await autofillResponse.json().catch(() => ({}))) as AutofillPayload;

      if (!autofillResponse.ok) {
        throw new Error(getApiErrorMessage(autofillPayload, "Autofill failed."));
      }

      const embeddedCount = Number(embedPayload.embeddedCount ?? 0);
      const answeredCount = Number(autofillPayload.answeredCount ?? 0);
      const totalCount = Number(autofillPayload.totalCount ?? 0);
      const notFoundCount = Number(autofillPayload.notFoundCount ?? 0);

      const embeddingPrefix =
        embeddedCount > 0 ? `Embedded ${embeddedCount} pending chunk${embeddedCount === 1 ? "" : "s"}. ` : "";
      setMessage(
        `${embeddingPrefix}Autofill complete: ${answeredCount}/${totalCount} answered, ${notFoundCount} not found.`
      );

      await fetchQuestionnaires();
    } catch (error) {
      setMessage(`Autofill failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setActiveAutofillId(null);
    }
  }

  return (
    <div className="page-stack">
      <Card className="home-launchpad-header">
        <div>
          <h2 style={{ margin: 0 }}>Workflow Launchpad</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Evidence-first questionnaire automation.
          </p>
        </div>
        <Link href="/questionnaires" className="btn btn-primary" aria-label="Open questionnaires">
          Open Questionnaires
        </Link>
      </Card>

      {message ? (
        <div
          className={cx(
            "message-banner",
            getMessageTone(message) === "notfound"
              ? "error"
              : getMessageTone(message) === "approved"
                ? "success"
                : ""
          )}
        >
          {message}
        </div>
      ) : null}

      <Card>
        <div className="card-title-row">
          <h3 style={{ margin: 0 }}>Quick Actions</h3>
          {isDashboardRefreshing ? <Badge tone="review">Refreshing...</Badge> : null}
        </div>
        <div className="quick-actions-grid">
          {mostRecentQuestionnaire ? (
            <section className="quick-action-card quick-action-card-primary">
              <h4 style={{ margin: "0 0 6px" }}>Continue Review</h4>
              <p className="small muted" style={{ margin: "0 0 10px" }}>
                Resume {mostRecentQuestionnaire.name}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push(`/questionnaires/${mostRecentQuestionnaire.id}`)}
              >
                Continue
              </Button>
            </section>
          ) : questionnairesState === "ready" ? (
            <section className="quick-action-card quick-action-card-primary">
              <h4 style={{ margin: "0 0 6px" }}>Create your first questionnaire</h4>
              <p className="small muted" style={{ margin: "0 0 10px" }}>
                Import CSV rows to start autofill and review.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/questionnaires#import")}
                disabled={!canImportQuestionnaires}
              >
                Import Questionnaire
              </Button>
            </section>
          ) : (
            <section className="quick-action-card quick-action-card-primary">
              <h4 style={{ margin: "0 0 6px" }}>Continue Review</h4>
              <p className="small muted" style={{ margin: "0 0 10px" }}>
                Sign in and open questionnaires to continue work.
              </p>
              <Link href="/questionnaires" className="btn btn-secondary">
                Open
              </Link>
            </section>
          )}

          <section className="quick-action-card">
            <h4 style={{ margin: "0 0 6px" }}>Import Questionnaire</h4>
            <p className="small muted" style={{ margin: "0 0 10px" }}>
              Upload CSV rows and create a new review run.
            </p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/questionnaires#import")}
              disabled={!canImportQuestionnaires}
            >
              Import
            </Button>
          </section>

          <section className="quick-action-card">
            <h4 style={{ margin: "0 0 6px" }}>Manage Documents</h4>
            <p className="small muted" style={{ margin: "0 0 10px" }}>
              Upload, inspect, and maintain source evidence.
            </p>
            <Link href="/documents" className="btn btn-ghost">
              Open Documents
            </Link>
          </section>

          {canInviteMembers ? (
            <section className="quick-action-card">
              <h4 style={{ margin: "0 0 6px" }}>Invite Teammate</h4>
              <p className="small muted" style={{ margin: "0 0 10px" }}>
                Add reviewers and manage role-scoped access.
              </p>
              <Link href="/settings/members#invite-member" className="btn btn-ghost">
                Invite
              </Link>
            </section>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="card-title-row">
          <h3 style={{ margin: 0 }}>Operational Snapshot</h3>
        </div>
        {snapshotCards.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Snapshot data is unavailable right now.
          </p>
        ) : (
          <div className="kpi-grid home-snapshot-grid">
            {snapshotCards.map((card) => (
              <div key={card.key} className="kpi-card">
                <div className="label">{card.label}</div>
                <div className="value">{card.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="card-title-row">
          <div>
            <h3 style={{ margin: 0 }}>Recent Questionnaires</h3>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Continue review, rerun autofill, or jump into exports.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => void refreshDashboard()} disabled={isDashboardRefreshing}>
            {isDashboardRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {questionnairesState === "loading" ? (
          <div className="muted small">Loading recent questionnaires...</div>
        ) : questionnairesState === "unavailable" ? (
          <div className="muted small">Questionnaire data is unavailable. Sign in to view workspace activity.</div>
        ) : recentQuestionnaires.length === 0 ? (
          <div className="empty-state">
            <h3 style={{ marginTop: 0 }}>No questionnaires yet</h3>
            <p>Import your first questionnaire to begin autofill and evidence-backed review.</p>
            <Link href="/questionnaires#import" className="btn btn-secondary">
              Import Questionnaire
            </Link>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Progress</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentQuestionnaires.map((questionnaire) => {
                  const completionPercent =
                    questionnaire.questionCount > 0
                      ? Math.round((questionnaire.answeredCount / questionnaire.questionCount) * 100)
                      : 0;
                  return (
                    <tr key={questionnaire.id}>
                      <td>
                        <strong>{questionnaire.name}</strong>
                      </td>
                      <td>
                        {completionPercent}% ({questionnaire.answeredCount}/{questionnaire.questionCount}) | Not found{" "}
                        {questionnaire.notFoundCount}
                      </td>
                      <td className="muted">{formatUpdatedAt(questionnaire.updatedAt || questionnaire.createdAt)}</td>
                      <td>
                        <div className="table-actions">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => router.push(`/questionnaires/${questionnaire.id}`)}
                            aria-label={`Open questionnaire ${questionnaire.name}`}
                          >
                            Open
                          </Button>
                          {canRunAutofill ? (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => void runAutofill(questionnaire.id)}
                              disabled={activeAutofillId === questionnaire.id}
                              aria-label={`Run autofill for questionnaire ${questionnaire.name}`}
                            >
                              {activeAutofillId === questionnaire.id ? "Running..." : "Run Autofill"}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isFirstRun ? (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Step 1</div>
            <div className="value">Ingest</div>
            <div className="muted small">Upload `.txt` and `.md`, then embed chunks.</div>
          </div>
          <div className="stat-card">
            <div className="label">Step 2</div>
            <div className="value">Autofill</div>
            <div className="muted small">Run answer engine across imported questionnaire rows.</div>
          </div>
          <div className="stat-card">
            <div className="label">Step 3</div>
            <div className="value">Review</div>
            <div className="muted small">Approve or flag answers and track citation coverage.</div>
          </div>
          <div className="stat-card">
            <div className="label">Step 4</div>
            <div className="value">Export</div>
            <div className="muted small">Download generated, approved-only, or preferred answers.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
