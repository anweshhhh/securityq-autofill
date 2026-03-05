import type { Prisma, PrismaClient } from "@prisma/client";
import { ApiRouteError } from "@/lib/approvalValidation";
import { NOT_FOUND_TEXT, normalizeTemplateText } from "@/shared/answerTemplates";

type DbClient = Prisma.TransactionClient | PrismaClient;

function normalizeChunkIds(chunkIds: string[]): string[] {
  return Array.from(new Set(chunkIds.map((chunkId) => chunkId.trim()).filter((chunkId) => chunkId.length > 0)));
}

export function normalizeApprovalAnswerAndCitations(input: {
  answerText: string;
  citationChunkIds: string[];
}): {
  answerText: string;
  citationChunkIds: string[];
  isNotFound: boolean;
} {
  const answerText = normalizeTemplateText(input.answerText);
  const citationChunkIds = normalizeChunkIds(input.citationChunkIds);

  if (!answerText) {
    throw new ApiRouteError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "answerText must be non-empty."
    });
  }

  const isNotFound = answerText === NOT_FOUND_TEXT;
  if (isNotFound && citationChunkIds.length > 0) {
    throw new ApiRouteError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "NOT_FOUND approvals must not include citationChunkIds."
    });
  }

  if (!isNotFound && citationChunkIds.length === 0) {
    throw new ApiRouteError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "citationChunkIds must be non-empty."
    });
  }

  return {
    answerText,
    citationChunkIds,
    isNotFound
  };
}

export async function syncApprovedAnswerEvidenceSnapshots(params: {
  db: DbClient;
  organizationId: string;
  approvedAnswerId: string;
  citationChunkIds: string[];
}): Promise<void> {
  const citationChunkIds = normalizeChunkIds(params.citationChunkIds);

  if (citationChunkIds.length === 0) {
    await params.db.approvedAnswerEvidence.deleteMany({
      where: {
        approvedAnswerId: params.approvedAnswerId
      }
    });
    return;
  }

  const chunks = await params.db.documentChunk.findMany({
    where: {
      id: {
        in: citationChunkIds
      },
      document: {
        organizationId: params.organizationId
      }
    },
    select: {
      id: true,
      evidenceFingerprint: true
    }
  });

  if (chunks.length !== citationChunkIds.length) {
    const resolvedChunkIds = new Set(chunks.map((chunk) => chunk.id));
    const invalidChunkIds = citationChunkIds.filter((chunkId) => !resolvedChunkIds.has(chunkId));
    throw new ApiRouteError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "One or more citationChunkIds are invalid for this organization.",
      details: {
        invalidChunkIds
      }
    });
  }

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  await params.db.approvedAnswerEvidence.deleteMany({
    where: {
      approvedAnswerId: params.approvedAnswerId,
      chunkId: {
        notIn: citationChunkIds
      }
    }
  });

  for (const chunkId of citationChunkIds) {
    const chunk = chunkById.get(chunkId);
    if (!chunk) {
      continue;
    }

    await params.db.approvedAnswerEvidence.upsert({
      where: {
        approvedAnswerId_chunkId: {
          approvedAnswerId: params.approvedAnswerId,
          chunkId
        }
      },
      create: {
        approvedAnswerId: params.approvedAnswerId,
        chunkId,
        fingerprintAtApproval: chunk.evidenceFingerprint
      },
      update: {
        fingerprintAtApproval: chunk.evidenceFingerprint
      }
    });
  }
}
