import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getOrCreateDefaultOrganizationMock,
  createEmbeddingMock,
  generateGroundedAnswerMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock,
  searchChunksByKeywordTermsMock
} = vi.hoisted(() => ({
  getOrCreateDefaultOrganizationMock: vi.fn(),
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn(),
  searchChunksByKeywordTermsMock: vi.fn()
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
  retrieveTopChunks: retrieveTopChunksMock,
  searchChunksByKeywordTerms: searchChunksByKeywordTermsMock
}));

import { POST } from "./route";

describe("/api/questions/answer safety hardening", () => {
  beforeEach(() => {
    getOrCreateDefaultOrganizationMock.mockReset();
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();
    searchChunksByKeywordTermsMock.mockReset();
    searchChunksByKeywordTermsMock.mockResolvedValue([]);
  });

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
    expect(payload.answer.toLowerCase()).not.toContain("aws");
    expect(payload.answer.toLowerCase()).not.toContain("kms");
    expect(payload.confidence).toBe("low");
    expect(payload.needsReview).toBe(true);
    expect(payload.citations.length).toBeGreaterThan(0);
  });

  it("returns cited response for IR question when IR evidence exists", async () => {
    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(2);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-ir",
        docName: "Runbooks",
        quotedSnippet: "## Incident Response\nIncidents are triaged by severity levels SEV-1 through SEV-4.",
        fullContent:
          "## Incident Response\nIncidents are triaged by severity levels SEV-1 through SEV-4 and mitigation playbooks.",
        similarity: 0.9
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Incident response process includes severity levels and triage.",
      citationChunkIds: ["chunk-ir"],
      confidence: "high",
      needsReview: false
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "Describe your IR process and severity levels." })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).not.toBe("Not found in provided documents.");
    expect(payload.citations.length).toBeGreaterThan(0);
    expect(payload.citations.some((citation: { chunkId: string }) => citation.chunkId === "chunk-ir")).toBe(true);
  });

  it("prefers backup evidence over IR evidence for backup questions", async () => {
    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    countEmbeddedChunksForOrganizationMock.mockResolvedValue(4);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-ir",
        docName: "Incident Response",
        quotedSnippet: "Incident response plan includes triage and severity levels.",
        fullContent: "Incident response plan includes triage and severity levels.",
        similarity: 0.97
      },
      {
        chunkId: "chunk-backup",
        docName: "Backup and DR",
        quotedSnippet:
          "Backup & Disaster Recovery: Backups are performed daily. RPO is 24 hours and RTO is 24 hours.",
        fullContent:
          "Backup & Disaster Recovery: Backups are performed daily. Disaster recovery tests are annual. RPO is 24 hours and RTO is 24 hours.",
        similarity: 0.82
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Backups are performed daily and RTO/RPO are 24 hours.",
      citationChunkIds: ["chunk-backup"],
      confidence: "high",
      needsReview: false
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "What is your backup frequency and RTO/RPO?" })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).not.toBe("Not found in provided documents.");
    expect(payload.citations.some((citation: { chunkId: string }) => citation.chunkId === "chunk-backup")).toBe(
      true
    );
    expect(payload.citations.some((citation: { chunkId: string }) => citation.chunkId === "chunk-ir")).toBe(false);
  });
});
