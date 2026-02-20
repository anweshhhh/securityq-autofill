import { describe, expect, it, vi } from "vitest";

const {
  getOrCreateDefaultOrganizationMock,
  countEmbeddedChunksForOrganizationMock,
  createEmbeddingMock,
  retrieveTopChunksMock,
  generateGroundedAnswerMock
} = vi.hoisted(() => ({
  getOrCreateDefaultOrganizationMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  createEmbeddingMock: vi.fn(),
  retrieveTopChunksMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn()
}));

vi.mock("@/lib/defaultOrg", () => ({
  getOrCreateDefaultOrganization: getOrCreateDefaultOrganizationMock
}));

vi.mock("@/lib/retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock
}));

import { POST } from "./route";

describe("/api/questions/answer", () => {
  it("returns not found payload when no embedded chunks exist", async () => {
    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(0);

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "Do we support SSO?" })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true
    });

    expect(createEmbeddingMock).not.toHaveBeenCalled();
    expect(retrieveTopChunksMock).not.toHaveBeenCalled();
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });
});
