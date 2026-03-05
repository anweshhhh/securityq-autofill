import { prisma } from "@/lib/prisma";

function normalizeChunkIds(chunkIds: string[]): string[] {
  return Array.from(new Set(chunkIds.map((chunkId) => chunkId.trim()).filter((chunkId) => chunkId.length > 0)));
}

export type StaleQuestionnaireItem = {
  questionnaireItemId: string;
  rowIndex: number | null;
};

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

export async function findStaleApprovedItemsForQuestionnaire(params: {
  questionnaireId: string;
  orgId: string;
}): Promise<StaleQuestionnaireItem[]> {
  const approvedQuestions = await prisma.question.findMany({
    where: {
      questionnaireId: params.questionnaireId,
      questionnaire: {
        organizationId: params.orgId
      },
      approvedAnswer: {
        isNot: null
      }
    },
    orderBy: {
      rowIndex: "asc"
    },
    select: {
      id: true,
      rowIndex: true,
      approvedAnswer: {
        select: {
          id: true,
          citationChunkIds: true
        }
      }
    }
  });

  if (approvedQuestions.length === 0) {
    return [];
  }

  const approvedAnswers = approvedQuestions
    .map((question) => {
      if (!question.approvedAnswer) {
        return null;
      }

      return {
        questionId: question.id,
        rowIndex: question.rowIndex,
        approvedAnswerId: question.approvedAnswer.id,
        citationChunkIds: normalizeChunkIds(question.approvedAnswer.citationChunkIds)
      };
    })
    .filter(
      (
        entry
      ): entry is {
        questionId: string;
        rowIndex: number;
        approvedAnswerId: string;
        citationChunkIds: string[];
      } => Boolean(entry)
    );

  if (approvedAnswers.length === 0) {
    return [];
  }

  const approvedAnswerIds = approvedAnswers.map((entry) => entry.approvedAnswerId);
  const snapshots = await prisma.approvedAnswerEvidence.findMany({
    where: {
      approvedAnswerId: {
        in: approvedAnswerIds
      }
    },
    select: {
      approvedAnswerId: true,
      chunkId: true,
      fingerprintAtApproval: true
    }
  });

  const snapshotsByApprovedAnswerId = new Map<string, Array<{ chunkId: string; fingerprintAtApproval: string }>>();
  for (const snapshot of snapshots) {
    const existing = snapshotsByApprovedAnswerId.get(snapshot.approvedAnswerId) ?? [];
    existing.push({
      chunkId: snapshot.chunkId,
      fingerprintAtApproval: snapshot.fingerprintAtApproval
    });
    snapshotsByApprovedAnswerId.set(snapshot.approvedAnswerId, existing);
  }

  const allSnapshotChunkIds = Array.from(new Set(snapshots.map((snapshot) => snapshot.chunkId)));
  const currentChunks =
    allSnapshotChunkIds.length > 0
      ? await prisma.documentChunk.findMany({
          where: {
            id: {
              in: allSnapshotChunkIds
            },
            document: {
              organizationId: params.orgId
            }
          },
          select: {
            id: true,
            evidenceFingerprint: true
          }
        })
      : [];
  const currentChunkById = new Map(currentChunks.map((chunk) => [chunk.id, chunk.evidenceFingerprint]));

  const staleItems: StaleQuestionnaireItem[] = [];

  for (const approvedAnswer of approvedAnswers) {
    const citationChunkIds = approvedAnswer.citationChunkIds;
    if (citationChunkIds.length === 0) {
      continue;
    }

    const snapshotsForAnswer = snapshotsByApprovedAnswerId.get(approvedAnswer.approvedAnswerId) ?? [];
    if (snapshotsForAnswer.length !== citationChunkIds.length) {
      staleItems.push({
        questionnaireItemId: approvedAnswer.questionId,
        rowIndex: approvedAnswer.rowIndex ?? null
      });
      continue;
    }

    const snapshotFingerprintByChunkId = new Map(
      snapshotsForAnswer.map((snapshot) => [snapshot.chunkId, snapshot.fingerprintAtApproval])
    );
    const hasMissingSnapshotChunk = citationChunkIds.some(
      (chunkId) => !snapshotFingerprintByChunkId.has(chunkId)
    );
    if (hasMissingSnapshotChunk) {
      staleItems.push({
        questionnaireItemId: approvedAnswer.questionId,
        rowIndex: approvedAnswer.rowIndex ?? null
      });
      continue;
    }

    let isStale = false;
    for (const snapshot of snapshotsForAnswer) {
      const currentFingerprint = currentChunkById.get(snapshot.chunkId);
      if (!currentFingerprint || currentFingerprint !== snapshot.fingerprintAtApproval) {
        isStale = true;
        break;
      }
    }

    if (isStale) {
      staleItems.push({
        questionnaireItemId: approvedAnswer.questionId,
        rowIndex: approvedAnswer.rowIndex ?? null
      });
    }
  }

  return staleItems;
}
