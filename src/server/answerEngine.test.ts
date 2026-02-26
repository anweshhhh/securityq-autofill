import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEmbeddingMock,
  generateGroundedAnswerMock,
  generateEvidenceSufficiencyMock,
  generateLegacyEvidenceSufficiencyMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock,
  generateLegacyEvidenceSufficiency: generateLegacyEvidenceSufficiencyMock
}));

vi.mock("@/lib/retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import { answerQuestion } from "./answerEngine";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), `test/fixtures/${name}`), "utf8");
}

describe("MVP answer engine contract", () => {
  beforeEach(() => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();

    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.02));
  });

  it("FOUND: returns answer with non-empty citations and citation subset of selected chunks", async () => {
    const evidenceB = fixture("evidence-b.txt");

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-b1",
        docName: "Evidence B",
        quotedSnippet: evidenceB,
        fullContent: evidenceB,
        similarity: 0.87
      },
      {
        chunkId: "chunk-b2",
        docName: "Evidence B",
        quotedSnippet: "Auxiliary control text.",
        fullContent: "Auxiliary control text.",
        similarity: 0.62
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      requirements: ["MFA required for workforce sign-in"],
      extracted: [
        {
          requirement: "MFA required for workforce sign-in",
          value: "Two-factor authentication is enabled for workforce sign-in.",
          supportingChunkIds: ["chunk-b1"]
        }
      ],
      overall: "FOUND"
    });

    const result = await answerQuestion({
      orgId: "org-1",
      questionText: "Do you enforce MFA for workforce sign-in?",
      debug: true
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);

    const chosenChunkIds = new Set(result.debug?.chosenChunks.map((chunk) => chunk.chunkId) ?? []);
    expect(chosenChunkIds.size).toBeGreaterThan(0);
    for (const citation of result.citations) {
      expect(chosenChunkIds.has(citation.chunkId)).toBe(true);
    }
  });

  it("NOT_FOUND: returns exact text and empty citations when evidence is insufficient", async () => {
    const evidenceA = fixture("evidence-a.txt");

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-a1",
        docName: "Evidence A",
        quotedSnippet: evidenceA,
        fullContent: evidenceA,
        similarity: 0.78
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      requirements: ["Log retention period"],
      extracted: [
        {
          requirement: "Log retention period",
          value: null,
          supportingChunkIds: []
        }
      ],
      overall: "NOT_FOUND"
    });

    const result = await answerQuestion({
      orgId: "org-1",
      questionText: "How long are logs retained?"
    });

    expect(result.answer).toBe("Not found in provided documents.");
    expect(result.citations).toEqual([]);
  });

  it("PARTIAL: returns Not specified text with non-empty citations when evidence is partial", async () => {
    const evidenceA = fixture("evidence-a.txt");

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-a1",
        docName: "Evidence A",
        quotedSnippet: evidenceA,
        fullContent: evidenceA,
        similarity: 0.89
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      requirements: ["MFA required for all employee accounts", "Enrollment method"],
      extracted: [
        {
          requirement: "MFA required for all employee accounts",
          value: "MFA is enabled for all employee accounts.",
          supportingChunkIds: ["chunk-a1"]
        },
        {
          requirement: "Enrollment method",
          value: null,
          supportingChunkIds: []
        }
      ],
      overall: "PARTIAL"
    });

    const result = await answerQuestion({
      orgId: "org-1",
      questionText: "Is MFA required for all employee accounts?"
    });

    expect(result.answer).toBe("Not specified in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it("does not clobber an affirmative grounded answer when sufficiency is true and citations are valid", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        docName: "Evidence A",
        quotedSnippet: "Q: Do you encrypt data in transit? A: Yes. External interfaces require TLS 1.2+.",
        fullContent: "Q: Do you encrypt data in transit? A: Yes. External interfaces require TLS 1.2+.",
        similarity: 0.91
      },
      {
        chunkId: "chunk-2",
        docName: "Evidence B",
        quotedSnippet: "Public APIs terminate SSL/TLS at the edge (minimum TLS 1.2).",
        fullContent: "Public APIs terminate SSL/TLS at the edge (minimum TLS 1.2).",
        similarity: 0.88
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      requirements: ["Encrypt data in transit", "Minimum TLS version"],
      extracted: [
        {
          requirement: "Encrypt data in transit",
          value: "Data is encrypted in transit.",
          supportingChunkIds: ["chunk-1"]
        },
        {
          requirement: "Minimum TLS version",
          value: "Minimum TLS version enforced is TLS 1.2.",
          supportingChunkIds: ["chunk-2"]
        }
      ],
      overall: "FOUND"
    });

    const result = await answerQuestion({
      orgId: "org-1",
      questionText: "Do you encrypt data in transit and enforce minimum TLS 1.2?"
    });

    expect(result.answer).not.toBe("Not specified in provided documents.");
    expect(result.answer).toContain("encrypted in transit");
    expect(result.answer).toContain("TLS 1.2");
    expect(result.citations.map((citation) => citation.chunkId)).toEqual(
      expect.arrayContaining(["chunk-1", "chunk-2"])
    );
    expect(result.citations.length).toBeGreaterThan(0);
  });
});
