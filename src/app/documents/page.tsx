"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppAuthz } from "@/components/AppAuthzContext";
import { CollapsibleInputSection } from "@/components/CollapsibleInputSection";
import { OperationalSummaryBand } from "@/components/OperationalSummaryBand";
import { Badge, Button, Card, TextInput, cx } from "@/components/ui";
import { can, RbacAction } from "@/server/rbac";

type DocumentRow = {
  id: string;
  name: string;
  displayName: string;
  originalName: string;
  mimeType: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
};

type UploadResponsePayload = {
  document?: { originalName: string; chunkCount: number };
  error?: string | { message?: string; code?: string };
};

function toTimeValue(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isNewerDocument(next: DocumentRow, current: DocumentRow): boolean {
  const nextUpdated = toTimeValue(next.updatedAt);
  const currentUpdated = toTimeValue(current.updatedAt);
  if (nextUpdated !== currentUpdated) {
    return nextUpdated > currentUpdated;
  }

  const nextCreated = toTimeValue(next.createdAt);
  const currentCreated = toTimeValue(current.createdAt);
  if (nextCreated !== currentCreated) {
    return nextCreated > currentCreated;
  }

  return next.id > current.id;
}

function statusBadge(status: string) {
  if (status === "ERROR") {
    return "notfound";
  }

  if (status === "CHUNKED") {
    return "approved";
  }

  return "review";
}

function messageTone(message: string): "approved" | "review" | "notfound" {
  const normalized = message.toLowerCase();
  if (normalized.includes("failed") || normalized.includes("error")) {
    return "notfound";
  }

  if (normalized.includes("uploaded") || normalized.includes("deleted")) {
    return "approved";
  }

  return "review";
}

function extractErrorMessage(errorValue: UploadResponsePayload["error"], fallback: string): string {
  if (typeof errorValue === "string" && errorValue.trim()) {
    return errorValue.trim();
  }

  if (
    errorValue &&
    typeof errorValue === "object" &&
    typeof errorValue.message === "string" &&
    errorValue.message.trim()
  ) {
    return errorValue.message.trim();
  }

  return fallback;
}

function documentTypeLabel(document: Pick<DocumentRow, "mimeType" | "originalName">): "PDF" | "MD" | "TXT" {
  const mimeType = document.mimeType.toLowerCase();
  const originalName = document.originalName.toLowerCase();

  if (mimeType.includes("pdf") || originalName.endsWith(".pdf")) {
    return "PDF";
  }

  if (mimeType.includes("markdown") || originalName.endsWith(".md")) {
    return "MD";
  }

  return "TXT";
}

export default function DocumentsPage() {
  const { role, orgId } = useAppAuthz();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [isUploadSectionExpanded, setIsUploadSectionExpanded] = useState(true);
  const uploadCollapseInitializedRef = useRef(false);

  const visibleDocuments = useMemo(() => {
    if (!showLatestOnly) {
      return [...documents];
    }

    const latestByOriginalName = new Map<string, DocumentRow>();
    for (const document of documents) {
      const key = document.originalName || document.name || document.id;
      const existing = latestByOriginalName.get(key);
      if (!existing || isNewerDocument(document, existing)) {
        latestByOriginalName.set(key, document);
      }
    }

    return Array.from(latestByOriginalName.values()).sort(
      (left, right) => toTimeValue(right.updatedAt) - toTimeValue(left.updatedAt)
    );
  }, [documents, showLatestOnly]);

  const embeddedCount = visibleDocuments.filter((document) => document.status === "CHUNKED").length;
  const filteredDocuments = useMemo(() => {
    const lowered = searchText.trim().toLowerCase();
    if (!lowered) {
      return visibleDocuments;
    }

    return visibleDocuments.filter((document) => {
      return (
        document.displayName.toLowerCase().includes(lowered) ||
        document.originalName.toLowerCase().includes(lowered) ||
        document.status.toLowerCase().includes(lowered)
      );
    });
  }, [searchText, visibleDocuments]);
  const canUploadDocuments = role ? can(role, RbacAction.UPLOAD_DOCUMENTS) : false;
  const canDeleteDocuments = role ? can(role, RbacAction.DELETE_DOCUMENTS) : false;

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload = (await response.json()) as { documents: DocumentRow[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch documents");
      }

      setDocuments(payload.documents);
      if (!uploadCollapseInitializedRef.current) {
        setIsUploadSectionExpanded(payload.documents.length === 0);
        uploadCollapseInitializedRef.current = true;
      }
      setSelectedDocumentIds((current) =>
        current.filter((selectedId) => payload.documents.some((document) => document.id === selectedId))
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to fetch documents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments, orgId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUploadDocuments) {
      setMessage("You do not have permission to upload documents.");
      return;
    }

    if (!selectedFile) {
      setMessage("Select a .txt, .md, or .pdf file first.");
      return;
    }

    setIsUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (process.env.NODE_ENV !== "production") {
        console.info("[documents/upload]", { status: response.status, contentType });
      }

      let payload: UploadResponsePayload | null = null;
      if (contentType.toLowerCase().includes("application/json")) {
        payload = (await response.json()) as UploadResponsePayload;
      } else {
        const rawText = await response.text();
        const snippet = rawText.replace(/\s+/g, " ").trim().slice(0, 300);
        if (process.env.NODE_ENV !== "production") {
          console.error("[documents/upload] non-json response", {
            status: response.status,
            contentType,
            snippet
          });
        }
        throw new Error(
          `Upload failed with non-JSON response (${response.status}, ${contentType || "unknown"}): ${snippet}`
        );
      }

      if (!response.ok) {
        throw new Error(extractErrorMessage(payload?.error, "Upload failed"));
      }

      setSelectedFile(null);
      setMessage(
        `Uploaded ${payload.document?.originalName ?? "file"} (${payload.document?.chunkCount ?? 0} chunks).`
      );

      await fetchDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function deleteDocuments(ids: string[]) {
    if (!canDeleteDocuments) {
      setMessage("You do not have permission to delete documents.");
      return;
    }

    if (ids.length === 0) {
      setMessage("Select at least one document to delete.");
      return;
    }

    const confirmMessage =
      ids.length === 1
        ? "Delete this document? This also removes stored chunks."
        : `Delete ${ids.length} documents? This also removes stored chunks.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsDeleting(true);
    setMessage("");

    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) {
            return { id, ok: false, error: payload.error ?? "Delete failed" };
          }

          return { id, ok: true };
        })
      );

      const failed = results.filter((result) => !result.ok);
      const succeeded = results.length - failed.length;

      if (failed.length > 0) {
        setMessage(`Deleted ${succeeded} document(s). ${failed.length} failed.`);
      } else {
        setMessage(`Deleted ${succeeded} document(s).`);
      }

      setSelectedDocumentIds([]);
      await fetchDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setIsDeleting(false);
    }
  }

  const allVisibleSelected =
    filteredDocuments.length > 0 &&
    filteredDocuments.every((document) => selectedDocumentIds.includes(document.id));

  return (
    <div className="page-stack">
      <OperationalSummaryBand
        kicker="Library health"
        summary={
          filteredDocuments.length > 0
            ? `${filteredDocuments.length} evidence file${filteredDocuments.length === 1 ? "" : "s"} are visible in the current inventory view, with ${embeddedCount} already chunked and ready for grounded retrieval.`
            : "Keep the evidence library clean and current so questionnaire answers stay grounded in trustworthy source material."
        }
        note="Ingestion belongs here. Review context belongs in the workbench."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchDocuments()}
              disabled={isLoading || isUploading || isDeleting}
            >
              {isLoading ? "Refreshing..." : "Refresh inventory"}
            </Button>
            <a href="#upload" className="btn btn-ghost">
              Jump to upload
            </a>
          </>
        }
        stats={[
          {
            label: "Visible files",
            value: filteredDocuments.length,
            helper: "Current inventory view"
          },
          {
            label: "Embedded",
            value: embeddedCount,
            helper: "Chunked and ready"
          },
          {
            label: "Selected",
            value: selectedDocumentIds.length,
            helper: "Queued for bulk actions"
          }
        ]}
      />

      <CollapsibleInputSection
        id="upload"
        title="Upload Evidence"
        helperText="Add `.txt`, `.md`, or `.pdf` evidence files. Upload keeps chunk extraction deterministic."
        expanded={isUploadSectionExpanded}
        onToggle={() => setIsUploadSectionExpanded((value) => !value)}
        badgeLabel="Ingestion"
        badgeTone="draft"
        badgeTitle="Ingestion pipeline"
      >
        <form onSubmit={handleSubmit} className="page-stack">
          <div className="surface-split">
            <div className="empty-state upload-callout">
              <h3 style={{ marginTop: 0 }}>Prefer final source packs</h3>
              <p>Add `.txt`, `.md`, or `.pdf` files that represent the most current source of truth.</p>
              <p className="small muted" style={{ marginBottom: 0 }}>
                The cleaner this library stays, the better autofill and stale-drift review behave downstream.
              </p>
            </div>

            <div className="card card-muted intake-panel">
              <label className="small muted" htmlFor="document-upload-file">
                Evidence file
              </label>
              <TextInput
                id="document-upload-file"
                type="file"
                accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                disabled={!canUploadDocuments}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                }}
              />
              <p className="small muted" style={{ marginBottom: 0 }}>
                Prefer the final source pack rather than intermediate drafts when possible.
              </p>
            </div>
          </div>

          <div className="toolbar-row">
            <Button type="submit" variant="primary" disabled={isUploading || !selectedFile || !canUploadDocuments}>
              {isUploading ? "Uploading..." : "Upload Evidence"}
            </Button>
          </div>
        </form>
      </CollapsibleInputSection>

      {message ? (
        <div
          className={cx(
            "message-banner",
            messageTone(message) === "notfound"
              ? "error"
              : messageTone(message) === "approved"
                ? "success"
                : ""
          )}
        >
          {message}
        </div>
      ) : null}

      <Card className="section-shell">
        <div className="card-title-row">
          <div className="section-copy">
            <span className="section-kicker">Inventory</span>
            <div>
              <h2 style={{ marginBottom: 4 }}>Evidence inventory</h2>
              <p className="muted" style={{ margin: 0 }}>
                Track chunked status and remove stale files.
              </p>
            </div>
          </div>
          <div className="toolbar-row compact filter-toolbar">
            <div className="search-field">
              <label className="search-field-label" htmlFor="documents-search">
                Search
              </label>
              <TextInput
                id="documents-search"
                className="search-field-input"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search evidence"
                title="Filter document list"
              />
              {searchText.trim().length > 0 ? (
                <button
                  type="button"
                  className="search-field-clear"
                  onClick={() => setSearchText("")}
                  aria-label="Clear document search"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <label className="toolbar-row small muted" htmlFor="latest-only">
              <input
                id="latest-only"
                type="checkbox"
                checked={showLatestOnly}
                onChange={(event) => setShowLatestOnly(event.target.checked)}
              />
              Show latest versions only
            </label>
            {canDeleteDocuments ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => void deleteDocuments(selectedDocumentIds)}
                disabled={isDeleting || selectedDocumentIds.length === 0}
              >
                {isDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            ) : null}
          </div>
        </div>

        {!isLoading && documents.length === 0 && searchText.trim().length === 0 ? (
          <div className="empty-state">
            <h3 style={{ marginTop: 0 }}>No evidence documents yet</h3>
            <p>Upload `.txt`, `.md`, or `.pdf` files to start the evidence pipeline.</p>
            <a href="#upload" className="btn btn-primary" aria-label="Jump to upload evidence section">
              Upload Evidence
            </a>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    {canDeleteDocuments ? (
                      <input
                        type="checkbox"
                        aria-label="Select all visible documents"
                        checked={allVisibleSelected}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setSelectedDocumentIds((current) => {
                              const combined = new Set([...current, ...filteredDocuments.map((document) => document.id)]);
                              return Array.from(combined);
                            });
                            return;
                          }

                          setSelectedDocumentIds((current) =>
                            current.filter(
                              (selectedId) => !filteredDocuments.some((document) => document.id === selectedId)
                            )
                          );
                        }}
                      />
                    ) : null}
                  </th>
                  <th>Name</th>
                  <th>Original</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Chunk count</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && filteredDocuments.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Loading documents...</td>
                  </tr>
                ) : null}

                {!isLoading && filteredDocuments.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No documents match the current search.</td>
                  </tr>
                ) : null}

                {filteredDocuments.map((document) => (
                  <tr key={document.id}>
                    <td>
                      {canDeleteDocuments ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${document.originalName}`}
                          checked={selectedDocumentIds.includes(document.id)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedDocumentIds((current) => [...current, document.id]);
                              return;
                            }

                            setSelectedDocumentIds((current) =>
                              current.filter((selectedId) => selectedId !== document.id)
                            );
                          }}
                        />
                      ) : null}
                    </td>
                    <td>
                      <strong>{document.displayName}</strong>
                    </td>
                    <td className="muted">{document.originalName}</td>
                    <td>
                      <Badge tone="draft">{documentTypeLabel(document)}</Badge>
                    </td>
                    <td>
                      <span className={cx("badge", `status-${statusBadge(document.status)}`)}>{document.status}</span>
                      {document.status === "ERROR" && document.errorMessage ? (
                        <div className="small status-notfound" style={{ marginTop: 6 }}>
                          {document.errorMessage}
                        </div>
                      ) : null}
                    </td>
                    <td>{document.chunkCount}</td>
                    <td className="muted">{new Date(document.updatedAt).toLocaleString()}</td>
                    <td>
                      {canDeleteDocuments ? (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => void deleteDocuments([document.id])}
                          disabled={isDeleting}
                          aria-label={`Delete document ${document.displayName}`}
                        >
                          Delete
                        </Button>
                      ) : (
                        <span className="small muted">View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
