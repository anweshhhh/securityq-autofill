import { describe, expect, it, vi } from "vitest";

const {
  getOrCreateDefaultOrganizationMock,
  createEmbeddingMock,
  generateGroundedAnswerMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  getOrCreateDefaultOrganizationMock: vi.fn(),
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("@/lib/defaultOrg", () => ({
  getOrCreateDefaultOrganization: getOrCreateDefaultOrganizationMock
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock
}));

vi.mock("@/lib/retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import { POST } from "./route";

describe("/api/questions/answer safety hardening", () => {
  it("downgrades unsupported claims after claim check", async () => {
    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(3);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        docName: "Security Notes",
        quotedSnippet: "Customer data is encrypted at rest.",
        fullContent: "Customer data is encrypted at rest and in transit with strong controls.",
        similarity: 0.88
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Customer data is encrypted at rest using AWS KMS.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "Is customer data encrypted at rest?" })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).toBe("Not specified in provided documents.");
    expect(payload.confidence).toBe("low");
    expect(payload.needsReview).toBe(true);
    expect(payload.citations).toHaveLength(1);
  });
});
