import {
  NOT_SPECIFIED_RESPONSE_TEXT,
  applyClaimCheckGuardrails,
  extractKeyTokens
} from "@/lib/claimCheck";
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
const MAX_CITATIONS = 3;
const MAX_CITATION_SNIPPET_CHARS = 520;

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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isSensitiveDetailQuestion(question: string): boolean {
  return /\b(vendor|third[- ]party|mfa|multi[- ]factor|encrypt|encryption|tls|kms|key management|aes|algorithm)\b/i.test(
    question
  );
}

function buildCitationSnippet(params: {
  chunk: RetrievedChunk;
  answer: string;
  question: string;
}): string {
  const fullContent = normalizeWhitespace(params.chunk.fullContent);
  const fallbackSnippet = normalizeWhitespace(params.chunk.quotedSnippet);

  if (!fullContent) {
    return fallbackSnippet;
  }

  if (fullContent.length <= MAX_CITATION_SNIPPET_CHARS) {
    return fullContent;
  }

  const anchorTokens = [
    ...extractKeyTokens(params.answer),
    ...extractKeyTokens(params.question)
  ].filter((token) => token.length >= 4);

  const contentLower = fullContent.toLowerCase();
  let anchorIndex = -1;

  for (const token of anchorTokens) {
    const index = contentLower.indexOf(token.toLowerCase());
    if (index >= 0 && (anchorIndex === -1 || index < anchorIndex)) {
      anchorIndex = index;
    }
  }

  if (anchorIndex < 0) {
    return (fallbackSnippet || fullContent.slice(0, MAX_CITATION_SNIPPET_CHARS)).slice(
      0,
      MAX_CITATION_SNIPPET_CHARS
    );
  }

  const contextBefore = Math.floor(MAX_CITATION_SNIPPET_CHARS / 3);
  const start = Math.max(0, anchorIndex - contextBefore);
  const end = Math.min(fullContent.length, start + MAX_CITATION_SNIPPET_CHARS);

  return fullContent.slice(start, end).trim();
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
    questionText: question,
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
  const citationChunkIds = Array.from(new Set(groundedAnswer.citationChunkIds)).slice(0, MAX_CITATIONS);

  const citations = citationChunkIds
    .map((chunkId) => citationMap.get(chunkId))
    .filter((value): value is RetrievedChunk => Boolean(value))
    .map((chunk) => ({
      docName: chunk.docName,
      chunkId: chunk.chunkId,
      quotedSnippet: buildCitationSnippet({
        chunk,
        answer: groundedAnswer.answer,
        question
      })
    }));

  const rawAnswer = groundedAnswer.answer.trim();
  if (!rawAnswer || rawAnswer === NOT_FOUND_RESPONSE.answer || citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const guarded = applyClaimCheckGuardrails({
    answer: rawAnswer,
    quotedSnippets: citations.map((citation) => citation.quotedSnippet),
    confidence: groundedAnswer.confidence,
    needsReview: groundedAnswer.needsReview
  });

  if (guarded.answer === NOT_FOUND_RESPONSE.answer) {
    return NOT_FOUND_RESPONSE;
  }

  const isPartial = guarded.answer.includes(NOT_SPECIFIED_RESPONSE_TEXT);
  let confidence = guarded.confidence;
  let needsReview = guarded.needsReview;

  if (isPartial) {
    confidence = "low";
    needsReview = true;
  }

  if (isSensitiveDetailQuestion(question) && confidence === "high") {
    confidence = "med";
  }

  return {
    answer: guarded.answer,
    citations,
    confidence,
    needsReview
  };
}
