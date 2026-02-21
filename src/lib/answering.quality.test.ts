import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEmbeddingMock,
  generateGroundedAnswerMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("./openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock
}));

vi.mock("./retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import { answerQuestionWithEvidence } from "./answering";

function mockSingleChunk(snippet: string, fullContent?: string, similarity = 0.9) {
  retrieveTopChunksMock.mockResolvedValue([
    {
      chunkId: "chunk-1",
      docName: "Doc 1",
      quotedSnippet: snippet,
      fullContent: fullContent ?? snippet,
      similarity
    }
  ]);
}

describe("answering quality guardrails", () => {
  beforeEach(() => {
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();

    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.02));
  });

  it("returns NOT_FOUND when no evidence chunks are embedded", async () => {
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(0);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How often are penetration tests performed?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true
    });
  });

  it("returns PARTIAL_SPEC with citations for partial encryption evidence", async () => {
    mockSingleChunk("Customer data is encrypted at rest.");
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Customer data is encrypted at rest.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Is customer data encrypted at rest and what algorithm and key rotation are used?"
    });

    expect(result.answer).toContain("Not specified in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });

  it("prevents unsupported token claims without dropping valid citations", async () => {
    mockSingleChunk("Customer data is encrypted at rest.");
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Customer data is encrypted at rest using AWS KMS.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Is customer data encrypted at rest?"
    });

    expect(result.answer).toContain("Not specified in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.confidence).toBe("low");
    expect(result.needsReview).toBe(true);
  });

  it("does not allow MFA required claim from truncated token evidence", async () => {
    mockSingleChunk(
      "MFA is enabled for workforce users and policy text says requir additional controls for admin access."
    );
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "MFA is required for all users.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Is MFA required for all users?"
    });

    expect(result.answer).toBe(
      "MFA is enabled; whether it is required is not specified in provided documents."
    );
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("marks vendor SOC2/SIG gaps as review-required and not high confidence", async () => {
    mockSingleChunk("We maintain a list of critical vendors and annual risk reviews.");
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "We maintain a list of critical vendors.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Do third-party vendors provide SOC2 and SIG reports?"
    });

    expect(result.answer).toContain("Not specified in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).not.toBe("high");
  });
});
