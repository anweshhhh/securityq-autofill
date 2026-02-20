import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { createEmbedding, generateGroundedAnswer } from "@/lib/openai";
import { countEmbeddedChunksForOrganization, retrieveTopChunks, type RetrievedChunk } from "@/lib/retrieval";

const TOP_K = 5;
const MIN_TOP_SIMILARITY = 0.35;

const NOT_FOUND_RESPONSE = {
  answer: "Not found in provided documents.",
  citations: [],
  confidence: "low" as const,
  needsReview: true
};

function hasSufficientEvidence(chunks: RetrievedChunk[]): boolean {
  if (chunks.length === 0) {
    return false;
  }

  return chunks[0].similarity >= MIN_TOP_SIMILARITY;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { question?: string };
    const question = payload.question?.trim();

    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const organization = await getOrCreateDefaultOrganization();
    const embeddedChunkCount = await countEmbeddedChunksForOrganization(organization.id);

    if (embeddedChunkCount === 0) {
      return NextResponse.json(NOT_FOUND_RESPONSE);
    }

    const questionEmbedding = await createEmbedding(question);
    const retrievedChunks = await retrieveTopChunks({
      organizationId: organization.id,
      questionEmbedding,
      topK: TOP_K
    });

    if (!hasSufficientEvidence(retrievedChunks)) {
      return NextResponse.json(NOT_FOUND_RESPONSE);
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
      return NextResponse.json(NOT_FOUND_RESPONSE);
    }

    return NextResponse.json({
      answer: groundedAnswer.answer,
      citations,
      confidence: groundedAnswer.confidence,
      needsReview: groundedAnswer.needsReview
    });
  } catch (error) {
    console.error("Failed to answer question", error);
    return NextResponse.json({ error: "Failed to answer question" }, { status: 500 });
  }
}
