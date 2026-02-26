import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateEvidenceSufficiency } from "@/lib/openai";

describe("generateEvidenceSufficiency prompt schema", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("includes strict array schema, no-maps instruction, and compact allowedChunkIds list", async () => {
    let capturedPayload: {
      messages?: Array<{ role?: string; content?: string }>;
    } | null = null;

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedPayload = JSON.parse(String(init?.body ?? "{}")) as typeof capturedPayload;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  requirements: ["Requirement A"],
                  extracted: [
                    {
                      requirement: "Requirement A",
                      value: "Observed value",
                      supportingChunkIds: ["chunk-a"]
                    }
                  ],
                  overall: "FOUND"
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    await generateEvidenceSufficiency({
      question: "What controls are in place?",
      snippets: [
        {
          chunkId: "chunk-a",
          docName: "Evidence A",
          quotedSnippet: "Control statement A."
        },
        {
          chunkId: "chunk-b",
          docName: "Evidence B",
          quotedSnippet: "Control statement B."
        }
      ]
    });

    expect(capturedPayload).not.toBeNull();
    const systemPrompt =
      capturedPayload?.messages?.find((message) => message.role === "system")?.content ?? "";
    const userPrompt =
      capturedPayload?.messages?.find((message) => message.role === "user")?.content ?? "";

    expect(systemPrompt).toContain("requirements: string[]");
    expect(systemPrompt).toContain(
      "extracted: Array<{ requirement: string, value: string | null, supportingChunkIds: string[] }>"
    );
    expect(systemPrompt).toContain("overall: \"FOUND\" | \"PARTIAL\" | \"NOT_FOUND\"");
    expect(systemPrompt).toContain("Do NOT use objects/maps for requirements or extracted. Use arrays only.");
    expect(systemPrompt).toContain("Output JSON only. No prose. No markdown. No code fences.");
    expect(systemPrompt).toContain("\"requirements\":[\"Requirement A\"]");
    expect(systemPrompt).toContain("supportingChunkIds");

    expect(userPrompt).toContain("allowedChunkIds (CSV): chunk-a,chunk-b");
    expect(userPrompt).toContain("Question:");
    expect(userPrompt).toContain("Snippets:");
  });
});
