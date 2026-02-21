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

function mockSingleChunk(snippet: string, fullContent?: string) {
  retrieveTopChunksMock.mockResolvedValue([
    {
      chunkId: "chunk-1",
      docName: "Doc 1",
      quotedSnippet: snippet,
      fullContent: fullContent ?? snippet,
      similarity: 0.9
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

  it("removes citations when final answer is Not specified", async () => {
    mockSingleChunk("Encryption controls are documented for infrastructure.");
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Not specified in provided documents.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: true
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "What encryption key algorithm is used?"
    });

    expect(result.answer).toBe("Not specified in provided documents.");
    expect(result.citations).toEqual([]);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("drops irrelevant citations based on question-term relevance", async () => {
    mockSingleChunk(
      "Incident response testing is completed quarterly and tracked by security operations."
    );
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Incident response testing is completed quarterly.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How do you handle data subject request deletion?"
    });

    expect(result.answer).toBe("Incident response testing is completed quarterly.");
    expect(result.citations).toEqual([]);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("claims MFA required only when evidence says required", async () => {
    mockSingleChunk(
      "MFA is enabled for all workforce user accounts and authentication policy says requir additional controls."
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
    expect(result.citations).toEqual([]);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("marks vendor SOC2/SIG detail gaps as needs review", async () => {
    mockSingleChunk("We maintain a list of critical vendors and annual risk reviews.");
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "We maintain a list of critical vendors.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Do vendors provide SOC2 and SIG reports?"
    });

    expect(result.answer).toContain("Not specified in provided documents.");
    expect(result.citations).toEqual([]);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });
});
