"use client";

import { FormEvent, useEffect, useState } from "react";

type DocumentRow = {
  id: string;
  name: string;
  originalName: string;
  status: string;
  createdAt: string;
  chunkCount: number;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function fetchDocuments() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload = (await response.json()) as { documents: DocumentRow[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch documents");
      }

      setDocuments(payload.documents);
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
      setMessage("Select a .txt or .md file first");
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
        `Uploaded ${payload.document?.originalName ?? "file"} (${payload.document?.chunkCount ?? 0} chunks)`
      );

      await fetchDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <main>
      <h1>Documents</h1>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setSelectedFile(file);
          }}
        />
        <button type="submit" disabled={isUploading}>
          {isUploading ? "Uploading..." : "Upload"}
        </button>
        <button type="button" onClick={() => void fetchDocuments()} disabled={isLoading || isUploading}>
          Refresh
        </button>
      </form>

      {message ? <p>{message}</p> : null}

      <h2>Uploaded Documents</h2>
      {isLoading ? <p>Loading...</p> : null}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Original Name</th>
            <th>Status</th>
            <th>Chunk Count</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {documents.length === 0 ? (
            <tr>
              <td colSpan={5}>No documents yet.</td>
            </tr>
          ) : (
            documents.map((document) => (
              <tr key={document.id}>
                <td>{document.name}</td>
                <td>{document.originalName}</td>
                <td>{document.status}</td>
                <td>{document.chunkCount}</td>
                <td>{new Date(document.createdAt).toLocaleString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </main>
  );
}
