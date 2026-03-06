import { NOT_FOUND_TEXT, normalizeTemplateText } from "@/shared/answerTemplates";
import { createEmbedding } from "@/lib/openai";
import { embeddingToVectorLiteral } from "@/lib/retrieval";
import { prisma } from "@/lib/prisma";
import { isApprovedAnswerStale } from "./staleness";

export type ReuseSuggestion = {
  approvedAnswerId: string;
  answerText: string;
  citationChunkIds: string[];
  similarity: number;
  isStale: false;
};

type SimilarityCandidate = {
  id: string;
  similarity: number;
};

type ApprovedAnswerCandidate = {
  id: string;
  answerText: string;
  citationChunkIds: string[];
};

function normalizeCitationChunkIds(chunkIds: string[]): string[] {
  return Array.from(new Set(chunkIds.map((chunkId) => chunkId.trim()).filter((chunkId) => chunkId.length > 0)));
}

export async function getReuseSuggestionsForQuestion(params: {
  orgId: string;
  questionText: string;
  excludeApprovedAnswerId?: string | null;
  limit?: number;
}): Promise<ReuseSuggestion[]> {
  const questionText = params.questionText.trim();
  if (!questionText) {
    return [];
  }

  if (questionText.length < 3) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.min(params.limit ?? 3, 10));
  const fallbackLimit = Math.max(normalizedLimit * 4, 12);

  const questionEmbedding = await createEmbedding(questionText);
  const rows = await prisma.$queryRawUnsafe<SimilarityCandidate[]>(
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
    params.orgId,
    fallbackLimit
  );

  if (rows.length === 0) {
    return [];
  }

  const orderedCandidateIds = rows.map((row) => row.id);
  const candidates = await prisma.approvedAnswer.findMany({
    where: {
      id: {
        in: orderedCandidateIds
      },
      organizationId: params.orgId
    },
    select: {
      id: true,
      answerText: true,
      citationChunkIds: true
    }
  });

  if (candidates.length === 0) {
    return [];
  }

  const candidateById = new Map<string, ApprovedAnswerCandidate>(
    candidates.map((candidate) => [
      candidate.id,
      {
        id: candidate.id,
        answerText: candidate.answerText,
        citationChunkIds: normalizeCitationChunkIds(candidate.citationChunkIds)
      }
    ])
  );

  const staleByApprovedAnswerId = new Map<string, Promise<boolean>>();
  const staleChecks = new Map<string, boolean>();

  const isStale = async (approvedAnswerId: string): Promise<boolean> => {
    const cached = staleChecks.get(approvedAnswerId);
    if (cached !== undefined) {
      return cached;
    }

    const pending = staleByApprovedAnswerId.get(approvedAnswerId);
    if (pending) {
      const resolved = await pending;
      staleChecks.set(approvedAnswerId, resolved);
      return resolved;
    }

    const next = isApprovedAnswerStale(approvedAnswerId, {
      orgId: params.orgId
    });
    staleByApprovedAnswerId.set(approvedAnswerId, next);
    const resolved = await next;
    staleChecks.set(approvedAnswerId, resolved);
    return resolved;
  };

  const filtered: ReuseSuggestion[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const candidate = candidateById.get(row.id);
    if (!candidate || seen.has(candidate.id)) {
      continue;
    }

    if (params.excludeApprovedAnswerId && candidate.id === params.excludeApprovedAnswerId) {
      continue;
    }

    const normalizedAnswerText = normalizeTemplateText(candidate.answerText);
    if (normalizedAnswerText === NOT_FOUND_TEXT) {
      continue;
    }

    const stale = await isStale(candidate.id);
    if (stale) {
      continue;
    }

    seen.add(candidate.id);
    filtered.push({
      approvedAnswerId: candidate.id,
      answerText: candidate.answerText,
      citationChunkIds: candidate.citationChunkIds,
      similarity: Number(row.similarity) || 0,
      isStale: false
    });

    if (filtered.length >= normalizedLimit) {
      break;
    }
  }

  if (filtered.length === 0) {
    return [];
  }

  return filtered;
}
