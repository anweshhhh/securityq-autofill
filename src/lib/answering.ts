import { createEmbedding, generateGroundedAnswer } from "@/lib/openai";
import { countEmbeddedChunksForOrganization, retrieveTopChunks, type RetrievedChunk } from "@/lib/retrieval";

export type Citation = {
  docName: string;
  chunkId: string;
  quotedSnippet: string;
};

export type EvidenceAnswer = {
  answer: string;
  citations: Citation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
};

const TOP_K = 5;
const MIN_TOP_SIMILARITY = 0.35;

export const NOT_FOUND_RESPONSE: EvidenceAnswer = {
  answer: "Not found in provided documents.",
  citations: [],
  confidence: "low",
  needsReview: true
};

function hasSufficientEvidence(chunks: RetrievedChunk[]): boolean {
  if (chunks.length === 0) {
    return false;
  }

  return chunks[0].similarity >= MIN_TOP_SIMILARITY;
}

export async function answerQuestionWithEvidence(params: {
  organizationId: string;
  question: string;
}): Promise<EvidenceAnswer> {
  const question = params.question.trim();
  if (!question) {
    return NOT_FOUND_RESPONSE;
  }

  const embeddedChunkCount = await countEmbeddedChunksForOrganization(params.organizationId);
  if (embeddedChunkCount === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const questionEmbedding = await createEmbedding(question);
  const retrievedChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding,
    topK: TOP_K
  });

  if (!hasSufficientEvidence(retrievedChunks)) {
    return NOT_FOUND_RESPONSE;
  }

  const groundedAnswer = await generateGroundedAnswer({
    question,
    snippets: retrievedChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      docName: chunk.docName,
      quotedSnippet: chunk.quotedSnippet
    }))
  });

  const citationMap = new Map(retrievedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citations = groundedAnswer.citationChunkIds
    .map((chunkId) => citationMap.get(chunkId))
    .filter((value): value is RetrievedChunk => Boolean(value))
    .map((chunk) => ({
      docName: chunk.docName,
      chunkId: chunk.chunkId,
      quotedSnippet: chunk.quotedSnippet
    }));

  if (groundedAnswer.answer.trim() === NOT_FOUND_RESPONSE.answer || citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  return {
    answer: groundedAnswer.answer,
    citations,
    confidence: groundedAnswer.confidence,
    needsReview: groundedAnswer.needsReview
  };
}
