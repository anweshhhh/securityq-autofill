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

function mockBackupOnlyChunks() {
  retrieveTopChunksMock.mockResolvedValue([
    {
      chunkId: "chunk-backup",
      docName: "Backup Policy",
      quotedSnippet: "Backups are performed daily. Disaster recovery tests are conducted annually.",
      fullContent:
        "Backups are performed daily. Disaster recovery tests are conducted annually. " +
        "RPO is 24 hours and RTO is 24 hours.",
      similarity: 0.94
    },
    {
      chunkId: "chunk-overview",
      docName: "Company Overview",
      quotedSnippet: "Our company profile and security mission statement.",
      fullContent: "Our company profile and security mission statement.",
      similarity: 0.92
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

  it("returns NOT_FOUND when only irrelevant backup chunks exist for pen tests", async () => {
    mockBackupOnlyChunks();

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

    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("returns two-part partial answer for backups evidence", async () => {
    mockSingleChunk(
      "Backups are performed daily. Disaster recovery tests are conducted annually. " +
        "RPO is 24 hours and RTO is 24 hours."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Backups and DR controls are defined.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question:
        "Please include backup frequency, DR testing frequency, RTO, RPO, retention period, and restore testing cadence."
    });

    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("backups are performed daily");
    expect(result.answer.toLowerCase()).toContain("disaster recovery tests are conducted annually");
    expect(result.answer.toLowerCase()).toContain("rpo is 24 hours");
    expect(result.answer.toLowerCase()).toContain("rto is 24 hours");
    expect(result.answer).toContain("Not specified in provided documents:");
    expect(result.answer.toLowerCase()).toContain("retention period");
    expect(result.answer.toLowerCase()).toContain("restore testing cadence");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });

  it("returns two-part IR answer with missing containment/eradication/recovery when absent", async () => {
    mockSingleChunk(
      "The incident response plan defines severity levels and triage workflows. " +
        "Mitigation playbooks are documented for security incidents."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Incident response controls exist.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question:
        "Describe incident response severity levels, triage, mitigation, containment, eradication, and recovery."
    });

    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("severity levels");
    expect(result.answer.toLowerCase()).toContain("triage");
    expect(result.answer.toLowerCase()).toContain("mitigation");
    expect(result.answer).toContain("Not specified in provided documents:");
    expect(result.answer.toLowerCase()).toContain("containment");
    expect(result.answer.toLowerCase()).toContain("eradication");
    expect(result.answer.toLowerCase()).toContain("recovery");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });

  it("prevents unsupported model claims while preserving evidence citations", async () => {
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

    expect(result.answer.toLowerCase()).not.toContain("aws");
    expect(result.answer.toLowerCase()).not.toContain("kms");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("falls back to NOT_FOUND when model returns invalid formatted output twice", async () => {
    mockSingleChunk(
      "Backups are performed daily. Disaster recovery tests are conducted annually. RPO is 24 hours and RTO is 24 hours."
    );

    generateGroundedAnswerMock
      .mockResolvedValueOnce({
        answer: "## Backup Evidence\n- Backups are performed daily",
        citationChunkIds: ["chunk-1"],
        confidence: "high",
        needsReview: false
      })
      .mockResolvedValueOnce({
        answer: "# Evidence Pack\nBackups are performed daily",
        citationChunkIds: ["chunk-1"],
        confidence: "high",
        needsReview: false
      });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "What is the backup frequency?"
    });

    expect(generateGroundedAnswerMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true
    });
  });
});
