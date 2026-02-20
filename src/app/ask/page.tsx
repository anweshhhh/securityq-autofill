"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AnswerPayload = {
  answer: string;
  citations: Array<{ docName: string; chunkId: string; quotedSnippet: string }>;
  confidence: "low" | "med" | "high";
  needsReview: boolean;
};

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnswerPayload | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!question.trim()) {
      setError("Question is required");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/questions/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ question })
      });

      const payload = (await response.json()) as AnswerPayload & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to answer question");
      }

      setResult(payload);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to answer question");
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main>
      <p>
        <Link href="/">Back to Home</Link>
      </p>
      <h1>Ask One Question</h1>

      <form onSubmit={handleSubmit}>
        <textarea
          rows={6}
          cols={80}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Enter one security question"
        />
        <br />
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Answering..." : "Submit"}
        </button>
      </form>

      {error ? <p>{error}</p> : null}

      {result ? (
        <section>
          <h2>Response</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      ) : null}
    </main>
  );
}
