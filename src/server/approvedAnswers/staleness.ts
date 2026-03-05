import { prisma } from "@/lib/prisma";

function normalizeChunkIds(chunkIds: string[]): string[] {
  return Array.from(new Set(chunkIds.map((chunkId) => chunkId.trim()).filter((chunkId) => chunkId.length > 0)));
}

export async function isApprovedAnswerStale(
  approvedAnswerId: string,
  ctx: {
    orgId: string;
  }
): Promise<boolean> {
  const approvedAnswer = await prisma.approvedAnswer.findFirst({
    where: {
      id: approvedAnswerId,
      organizationId: ctx.orgId
    },
    select: {
      citationChunkIds: true
    }
  });

  if (!approvedAnswer) {
    return true;
  }

  const citationChunkIds = normalizeChunkIds(approvedAnswer.citationChunkIds);
  if (citationChunkIds.length === 0) {
    return false;
  }

  const snapshots = await prisma.approvedAnswerEvidence.findMany({
    where: {
      approvedAnswerId
    },
    select: {
      chunkId: true,
      fingerprintAtApproval: true
    }
  });

  if (snapshots.length !== citationChunkIds.length) {
    return true;
  }

  const snapshotByChunkId = new Map(snapshots.map((snapshot) => [snapshot.chunkId, snapshot.fingerprintAtApproval]));

  for (const chunkId of citationChunkIds) {
    if (!snapshotByChunkId.has(chunkId)) {
      return true;
    }
  }

  const currentChunks = await prisma.documentChunk.findMany({
    where: {
      id: {
        in: citationChunkIds
      },
      document: {
        organizationId: ctx.orgId
      }
    },
    select: {
      id: true,
      evidenceFingerprint: true
    }
  });

  if (currentChunks.length !== citationChunkIds.length) {
    return true;
  }

  for (const currentChunk of currentChunks) {
    const snapshotFingerprint = snapshotByChunkId.get(currentChunk.id);
    if (!snapshotFingerprint || snapshotFingerprint !== currentChunk.evidenceFingerprint) {
      return true;
    }
  }

  return false;
}
