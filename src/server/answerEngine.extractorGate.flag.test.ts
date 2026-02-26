import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEmbeddingMock,
  generateEvidenceSufficiencyMock,
  generateLegacyEvidenceSufficiencyMock,
  generateGroundedAnswerMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  generateLegacyEvidenceSufficiencyMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("@/lib/openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock,
  generateLegacyEvidenceSufficiency: generateLegacyEvidenceSufficiencyMock,
  generateGroundedAnswer: generateGroundedAnswerMock
}));

vi.mock("@/lib/retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import { answerQuestion } from "./answerEngine";

const NOT_FOUND_TEXT = "Not found in provided documents.";

describe("extractor gate feature-flag rollout", () => {
  beforeEach(() => {
    process.env.DEV_MODE = "false";
    process.env.EXTRACTOR_GATE = "true";

    createEmbeddingMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    generateLegacyEvidenceSufficiencyMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();

    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.01));
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-1",
        docName: "Evidence Pack",
        quotedSnippet: "Production access is restricted to authorized personnel and follows least privilege.",
        fullContent: "Production access is restricted to authorized personnel and follows least privilege.",
        similarity: 0.94
      }
    ]);
  });

  it("returns FOUND in extractor mode and can return NOT_FOUND in legacy mode for the same evidence", async () => {
    generateEvidenceSufficiencyMock.mockResolvedValue({
      requirements: ["Production access restriction", "Least privilege"],
      extracted: [
        {
          requirement: "Production access restriction",
          value: "Production access is restricted to authorized personnel.",
          supportingChunkIds: ["chunk-1"]
        },
        {
          requirement: "Least privilege",
          value: "Access follows least privilege principles.",
          supportingChunkIds: ["chunk-1"]
        }
      ],
      overall: "FOUND"
    });

    const extractorResult = await answerQuestion({
      orgId: "org-1",
      questionText: "Is production access restricted and based on least privilege?",
      debug: true
    });

    expect(extractorResult.answer).not.toBe(NOT_FOUND_TEXT);
    expect(extractorResult.citations.length).toBeGreaterThan(0);
    expect(extractorResult.debug?.sufficiency?.overall).toBe("FOUND");

    process.env.EXTRACTOR_GATE = "false";
    generateLegacyEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: false,
      missingPoints: ["Evidence classifier failed to mark sufficiency"],
      supportingChunkIds: ["chunk-1"]
    });

    const legacyResult = await answerQuestion({
      orgId: "org-1",
      questionText: "Is production access restricted and based on least privilege?",
      debug: true
    });

    // Legacy mode is intentionally documented as potentially missing supported PDF-style evidence.
    expect(legacyResult.answer).toBe(NOT_FOUND_TEXT);
    expect(legacyResult.citations).toEqual([]);
    expect(legacyResult.debug?.sufficiency?.overall).toBe("NOT_FOUND");
  });
});
