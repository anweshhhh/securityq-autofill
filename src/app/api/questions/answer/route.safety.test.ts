import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getOrCreateDefaultOrganizationMock,
  createEmbeddingMock,
  generateGroundedAnswerMock,
  generateEvidenceSufficiencyMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  getOrCreateDefaultOrganizationMock: vi.fn(),
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("@/lib/defaultOrg", () => ({
  getOrCreateDefaultOrganization: getOrCreateDefaultOrganizationMock
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock
}));

vi.mock("@/lib/retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import { POST } from "./route";

describe("/api/questions/answer safety hardening", () => {
  beforeEach(() => {
    getOrCreateDefaultOrganizationMock.mockReset();
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();

    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(3);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));
    generateEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: true,
      bestChunkIds: ["chunk-1"],
      missingPoints: []
    });
  });

  it("downgrades unsupported claims after claim check", async () => {
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
      citations: [{ chunkId: "chunk-1", quotedSnippet: "Customer data is encrypted at rest." }],
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
    expect(payload.citations.length).toBeGreaterThan(0);
  });

  it("returns cited response when sufficiency is true", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        docName: "Runbooks",
        quotedSnippet: "Incidents are triaged by severity and routed to on-call owners.",
        fullContent:
          "Incidents are triaged by severity and routed to on-call owners with defined escalation timelines.",
        similarity: 0.9
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Incidents are triaged by severity with on-call ownership.",
      citations: [{ chunkId: "chunk-1", quotedSnippet: "triaged by severity" }],
      confidence: "med",
      needsReview: false
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "How are incidents triaged?" })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).not.toBe("Not found in provided documents.");
    expect(payload.citations.length).toBeGreaterThan(0);
    expect(payload.citations[0].chunkId).toBe("chunk-1");
  });

  it("returns NOT_FOUND when sufficiency is false", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        docName: "Policy",
        quotedSnippet: "The platform stores user account records.",
        fullContent: "The platform stores user account records.",
        similarity: 0.82
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: false,
      bestChunkIds: [],
      missingPoints: ["Missing retention duration"]
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "How long are user account records retained?" })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).toBe("Not found in provided documents.");
    expect(payload.citations).toEqual([]);
    expect(payload.notFoundReason).toBe("NO_RELEVANT_EVIDENCE");
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });
});
