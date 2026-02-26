import { createEmbedding } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { embeddingToVectorLiteral } from "@/lib/retrieval";
import {
  buildQuestionTextMetadata,
  questionTextNearExactSimilarity
} from "@/lib/questionText";
import { sanitizeExtractedText } from "@/lib/textNormalization";

const NOT_FOUND_TEXT = "Not found in provided documents.";
const NEAR_EXACT_MIN_SIMILARITY = 0.93;
const SEMANTIC_MIN_SIMILARITY = 0.88;
const MAX_SEMANTIC_CANDIDATES = 12;
const MAX_QUOTED_SNIPPET_CHARS = 700;

type ReuseMatchType = "exact" | "near_exact" | "semantic";

type ApprovedAnswerCandidate = {
  id: string;
  answerText: string;
  citationChunkIds: string[];
  normalizedQuestionText: string;
  questionTextHash: string;
  updatedAt: Date;
};

type ChunkCitation = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
};

type SemanticCandidateRow = {
  id: string;
  similarity: number;
};

export type ReusedApprovedAnswer = {
  approvedAnswerId: string;
  answerText: string;
  citations: ChunkCitation[];
  matchType: ReuseMatchType;
};

export type ApprovedAnswerReuseMatcher = {
  findForQuestion(questionText: string): Promise<ReusedApprovedAnswer | null>;
};

function normalizeSnippet(value: string): string {
  const normalized = sanitizeExtractedText(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_QUOTED_SNIPPET_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_QUOTED_SNIPPET_CHARS - 3)}...`;
}

function isReusableAnswerText(value: string): boolean {
  const normalized = sanitizeExtractedText(value).trim();
  if (!normalized) {
    return false;
  }

  return normalized !== NOT_FOUND_TEXT;
}

function normalizeChunkIdList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function compareByUpdatedAtDesc(left: ApprovedAnswerCandidate, right: ApprovedAnswerCandidate): number {
  const leftTime = left.updatedAt.getTime();
  const rightTime = right.updatedAt.getTime();
  if (leftTime === rightTime) {
    return left.id.localeCompare(right.id);
  }

  return rightTime - leftTime;
}

type CitationResolver = {
  resolveCitationChunkIds(chunkIds: string[]): Promise<ChunkCitation[] | null>;
};

async function createCitationResolver(organizationId: string): Promise<CitationResolver> {
  const cache = new Map<string, ChunkCitation | null>();

  const resolveCitationChunkIds = async (chunkIds: string[]) => {
    const normalizedChunkIds = normalizeChunkIdList(chunkIds);
    if (normalizedChunkIds.length === 0) {
      return null;
    }

    const missingChunkIds = normalizedChunkIds.filter((chunkId) => !cache.has(chunkId));
    if (missingChunkIds.length > 0) {
      for (const chunkId of missingChunkIds) {
        cache.set(chunkId, null);
      }

      const chunks = await prisma.documentChunk.findMany({
        where: {
          id: {
            in: missingChunkIds
          },
          document: {
            organizationId
          }
        },
        select: {
          id: true,
          content: true,
          document: {
            select: {
              name: true
            }
          }
        }
      });

      for (const chunk of chunks) {
        cache.set(chunk.id, {
          chunkId: chunk.id,
          docName: chunk.document.name,
          quotedSnippet: normalizeSnippet(chunk.content)
        });
      }
    }

    const citations: ChunkCitation[] = [];
    for (const chunkId of normalizedChunkIds) {
      const citation = cache.get(chunkId) ?? null;
      if (!citation) {
        return null;
      }

      citations.push(citation);
    }

    return citations;
  };

  return {
    resolveCitationChunkIds
  };
}

async function resolveBestCandidate(params: {
  candidates: ApprovedAnswerCandidate[];
  matchType: ReuseMatchType;
  citationResolver: CitationResolver;
}): Promise<ReusedApprovedAnswer | null> {
  for (const candidate of params.candidates) {
    if (!isReusableAnswerText(candidate.answerText)) {
      continue;
    }

    const citations = await params.citationResolver.resolveCitationChunkIds(candidate.citationChunkIds);
    if (!citations || citations.length === 0) {
      continue;
    }

    return {
      approvedAnswerId: candidate.id,
      answerText: sanitizeExtractedText(candidate.answerText).trim(),
      citations,
      matchType: params.matchType
    };
  }

  return null;
}

export async function createApprovedAnswerReuseMatcher(params: {
  organizationId: string;
}): Promise<ApprovedAnswerReuseMatcher> {
  const candidates = await prisma.approvedAnswer.findMany({
    where: {
      organizationId: params.organizationId
    },
    select: {
      id: true,
      answerText: true,
      citationChunkIds: true,
      normalizedQuestionText: true,
      questionTextHash: true,
      updatedAt: true
    }
  });
  const citationResolver = await createCitationResolver(params.organizationId);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  const findForQuestion = async (questionText: string): Promise<ReusedApprovedAnswer | null> => {
    if (candidates.length === 0) {
      return null;
    }

    const { normalizedQuestionText, questionTextHash } = buildQuestionTextMetadata(questionText);
    if (!normalizedQuestionText) {
      return null;
    }

    const exactCandidates = candidates
      .filter(
        (candidate) =>
          candidate.questionTextHash === questionTextHash ||
          candidate.normalizedQuestionText === normalizedQuestionText
      )
      .sort(compareByUpdatedAtDesc);

    const exactMatch = await resolveBestCandidate({
      candidates: exactCandidates,
      matchType: "exact",
      citationResolver
    });
    if (exactMatch) {
      return exactMatch;
    }

    const nearCandidates = candidates
      .map((candidate) => ({
        candidate,
        similarity: questionTextNearExactSimilarity(normalizedQuestionText, candidate.normalizedQuestionText)
      }))
      .filter(({ similarity }) => similarity >= NEAR_EXACT_MIN_SIMILARITY)
      .sort((left, right) => {
        if (left.similarity !== right.similarity) {
          return right.similarity - left.similarity;
        }

        return compareByUpdatedAtDesc(left.candidate, right.candidate);
      })
      .map(({ candidate }) => candidate);

    const nearMatch = await resolveBestCandidate({
      candidates: nearCandidates,
      matchType: "near_exact",
      citationResolver
    });
    if (nearMatch) {
      return nearMatch;
    }

    const questionEmbedding = await createEmbedding(questionText);
    const semanticRows = await prisma.$queryRawUnsafe<SemanticCandidateRow[]>(
      `
        SELECT
          aa."id" AS "id",
          (1 - (aa."questionEmbedding" <=> $1::vector(1536)))::float AS "similarity"
        FROM "ApprovedAnswer" aa
        WHERE aa."organizationId" = $2
          AND aa."questionEmbedding" IS NOT NULL
        ORDER BY "similarity" DESC, aa."updatedAt" DESC
        LIMIT $3
      `,
      embeddingToVectorLiteral(questionEmbedding),
      params.organizationId,
      MAX_SEMANTIC_CANDIDATES
    );

    const semanticCandidates = semanticRows
      .filter((row) => Number(row.similarity) >= SEMANTIC_MIN_SIMILARITY)
      .map((row) => candidateById.get(row.id))
      .filter((candidate): candidate is ApprovedAnswerCandidate => candidate !== undefined);

    return resolveBestCandidate({
      candidates: semanticCandidates,
      matchType: "semantic",
      citationResolver
    });
  };

  return {
    findForQuestion
  };
}
