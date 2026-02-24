import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEmbeddingMock,
  generateGroundedAnswerMock,
  generateEvidenceSufficiencyMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  generateEvidenceSufficiencyMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("./openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock,
  generateEvidenceSufficiency: generateEvidenceSufficiencyMock
}));

vi.mock("./retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import {
  answerQuestionWithEvidence,
  categorizeQuestion,
  chunkMatchesCategoryMustMatch,
  normalizeForMatch
} from "./answering";

function setRetrievedChunks(
  chunks: Array<{
    chunkId: string;
    docName: string;
    quotedSnippet: string;
    fullContent?: string;
    similarity: number;
  }>
) {
  retrieveTopChunksMock.mockResolvedValue(
    chunks.map((chunk) => ({
      ...chunk,
      fullContent: chunk.fullContent ?? chunk.quotedSnippet
    }))
  );
}

describe("answering generic QA hardening", () => {
  beforeEach(() => {
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    generateEvidenceSufficiencyMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();

    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.02));
    generateEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: true,
      bestChunkIds: ["chunk-1"],
      missingPoints: []
    });
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "The document confirms daily backups.",
      citations: [{ chunkId: "chunk-1", quotedSnippet: "Backups are performed daily." }],
      confidence: "med",
      needsReview: false
    });
  });

  it("uses domain-agnostic category routing", () => {
    expect(categorizeQuestion("Any question across any domain")).toBe("GENERAL");
    expect(chunkMatchesCategoryMustMatch("GENERAL", "Anything")).toBe(true);
    expect(normalizeForMatch("Résumé — v2.0")).toBe("r sum - v2.0");
  });

  it("returns RETRIEVAL_BELOW_THRESHOLD when similarity is low and no lexical overlap survives", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Doc 1",
        quotedSnippet: "Company holiday schedule and travel policy.",
        similarity: 0.1
      }
    ]);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How does the database sharding key strategy work?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "RETRIEVAL_BELOW_THRESHOLD"
    });
    expect(generateEvidenceSufficiencyMock).not.toHaveBeenCalled();
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("returns NO_RELEVANT_EVIDENCE when sufficiency check fails", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Architecture",
        quotedSnippet: "The system stores orders and users in PostgreSQL.",
        similarity: 0.78
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: false,
      bestChunkIds: [],
      missingPoints: ["No explicit retention duration"]
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "What is the order retention period in years?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("reranks by combined vector + lexical score deterministically", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Doc A",
        quotedSnippet: "General platform overview.",
        similarity: 0.9
      },
      {
        chunkId: "chunk-2",
        docName: "Doc B",
        quotedSnippet: "Database sharding key strategy uses customer_id hashing.",
        similarity: 0.7
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: true,
      bestChunkIds: ["chunk-2"],
      missingPoints: []
    });

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "The sharding key strategy hashes customer_id.",
      citations: [{ chunkId: "chunk-2", quotedSnippet: "customer_id hashing" }],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Describe the database sharding key strategy.",
      debug: true
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("chunk-2");
    expect(result.debug?.rerankedTopN[0]?.chunkId).toBe("chunk-2");
    expect(result.debug?.chosenChunks[0]?.chunkId).toBe("chunk-2");
  });

  it("returns FILTERED_AS_IRRELEVANT when model returns no valid citations", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Doc 1",
        quotedSnippet: "Backups are performed daily.",
        similarity: 0.85
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Backups are performed daily.",
      citations: [],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How often are backups performed?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "FILTERED_AS_IRRELEVANT"
    });
  });

  it("rewrites unsupported claims to Not specified and lowers confidence", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Encryption",
        quotedSnippet: "Customer data is encrypted at rest.",
        similarity: 0.82
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Customer data is encrypted at rest using AWS KMS.",
      citations: [{ chunkId: "chunk-1", quotedSnippet: "Customer data is encrypted at rest." }],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How is customer data encrypted at rest?"
    });

    expect(result.answer).toBe("Not specified in provided documents.");
    expect(result.confidence).toBe("low");
    expect(result.needsReview).toBe(true);
    expect(result.citations).toHaveLength(1);
  });

  it("rejects repeated raw markdown output via format enforcement", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Doc 1",
        quotedSnippet: "Backups are performed daily.",
        similarity: 0.86
      }
    ]);

    generateGroundedAnswerMock
      .mockResolvedValueOnce({
        answer: "# Evidence\nSnippet 1\nchunkId: chunk-1",
        citations: [{ chunkId: "chunk-1", quotedSnippet: "Backups are performed daily." }],
        confidence: "high",
        needsReview: false
      })
      .mockResolvedValueOnce({
        answer: "## Raw dump\nchunkId: chunk-1",
        citations: [{ chunkId: "chunk-1", quotedSnippet: "Backups are performed daily." }],
        confidence: "high",
        needsReview: false
      });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How often are backups performed?"
    });

    expect(generateGroundedAnswerMock).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe("Not found in provided documents.");
    expect(result.notFoundReason).toBe("FILTERED_AS_IRRELEVANT");
  });

  it("returns generic debug payload with sufficiency and chosen chunks", async () => {
    setRetrievedChunks([
      {
        chunkId: "chunk-1",
        docName: "Doc 1",
        quotedSnippet: "Backups are performed daily.",
        similarity: 0.85
      }
    ]);

    generateEvidenceSufficiencyMock.mockResolvedValue({
      sufficient: true,
      bestChunkIds: ["chunk-1"],
      missingPoints: []
    });

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Backups are performed daily.",
      citations: [{ chunkId: "chunk-1", quotedSnippet: "Backups are performed daily." }],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How often are backups performed?",
      debug: true
    });

    expect(result.debug).toBeDefined();
    expect(result.debug?.retrievedTopK.length).toBeGreaterThan(0);
    expect(result.debug?.rerankedTopN.length).toBeGreaterThan(0);
    expect(result.debug?.chosenChunks).toEqual([{ chunkId: "chunk-1", docName: "Doc 1" }]);
    expect(result.debug?.sufficiency).toEqual({
      sufficient: true,
      bestChunkIds: ["chunk-1"],
      missingPoints: []
    });
  });
});
