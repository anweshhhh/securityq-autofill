"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, TextInput, cx } from "@/components/ui";

type DocumentRow = {
  id: string;
  name: string;
  displayName: string;
  originalName: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
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

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState<string>("");

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

  async function fetchDocuments() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload = (await response.json()) as { documents: DocumentRow[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch documents");
      }

      setDocuments(payload.documents);
      setSelectedDocumentIds((current) =>
        current.filter((selectedId) => payload.documents.some((document) => document.id === selectedId))
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to fetch documents");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void fetchDocuments();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setMessage("Select a .txt or .md file first.");
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

      const payload = (await response.json()) as {
        document?: { originalName: string; chunkCount: number };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed");
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
    visibleDocuments.length > 0 &&
    visibleDocuments.every((document) => selectedDocumentIds.includes(document.id));

  return (
    <div className="page-stack">
      <Card id="upload">
        <div className="card-title-row">
          <div>
            <h2 style={{ marginBottom: 4 }}>Upload Evidence</h2>
            <p className="muted" style={{ margin: 0 }}>
              Add `.txt` and `.md` evidence files. Upload keeps chunk extraction deterministic.
            </p>
          </div>
          <Badge tone="draft" title="Ingestion pipeline">
            Ingestion
          </Badge>
        </div>

        <form onSubmit={handleSubmit} className="page-stack">
          <div className="empty-state">
            <h3 style={{ marginTop: 0 }}>Drop evidence files here</h3>
            <p>Drag-and-drop styling is active. Upload still uses the file selector for deterministic behavior.</p>
            <TextInput
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
              }}
            />
          </div>

          <div className="toolbar-row">
            <Button type="submit" variant="primary" disabled={isUploading || !selectedFile}>
              {isUploading ? "Uploading..." : "Upload Evidence"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchDocuments()}
              disabled={isLoading || isUploading || isDeleting}
            >
              Refresh
            </Button>
            <label className="toolbar-row small muted" htmlFor="latest-only">
              <input
                id="latest-only"
                type="checkbox"
                checked={showLatestOnly}
                onChange={(event) => setShowLatestOnly(event.target.checked)}
              />
              Show latest per original filename
            </label>
          </div>
        </form>
      </Card>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Visible documents</div>
          <div className="value">{visibleDocuments.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Embedded (chunked)</div>
          <div className="value">{embeddedCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">Selected</div>
          <div className="value">{selectedDocumentIds.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Filter mode</div>
          <div className="value">{showLatestOnly ? "Latest" : "All"}</div>
        </div>
      </div>

      {message ? (
        <Card className="card-muted">
          <Badge tone={messageTone(message)}>{message}</Badge>
        </Card>
      ) : null}

      <Card>
        <div className="card-title-row">
          <div>
            <h2 style={{ marginBottom: 4 }}>Document Inventory</h2>
            <p className="muted" style={{ margin: 0 }}>
              Track chunked status and remove stale files.
            </p>
          </div>
          <Button
            type="button"
            variant="danger"
            onClick={() => void deleteDocuments(selectedDocumentIds)}
            disabled={isDeleting || selectedDocumentIds.length === 0}
          >
            {isDeleting ? "Deleting..." : "Delete selected"}
          </Button>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible documents"
                    checked={allVisibleSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedDocumentIds((current) => {
                          const combined = new Set([...current, ...visibleDocuments.map((document) => document.id)]);
                          return Array.from(combined);
                        });
                        return;
                      }

                      setSelectedDocumentIds((current) =>
                        current.filter(
                          (selectedId) => !visibleDocuments.some((document) => document.id === selectedId)
                        )
                      );
                    }}
                  />
                </th>
                <th>Name</th>
                <th>Original</th>
                <th>Status</th>
                <th>Chunk count</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && visibleDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7}>Loading documents...</td>
                </tr>
              ) : null}

              {!isLoading && visibleDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7}>No documents uploaded yet.</td>
                </tr>
              ) : null}

              {visibleDocuments.map((document) => (
                <tr key={document.id}>
                  <td>
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
                  </td>
                  <td>
                    <strong>{document.displayName}</strong>
                  </td>
                  <td className="muted">{document.originalName}</td>
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
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void deleteDocuments([document.id])}
                      disabled={isDeleting}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
