import { prisma } from "@/lib/prisma";

function normalizeChunkIds(chunkIds: string[]): string[] {
  return Array.from(new Set(chunkIds.map((chunkId) => chunkId.trim()).filter((chunkId) => chunkId.length > 0)));
}

export type ApprovedAnswerStalenessCandidate = {
  approvedAnswerId: string;
  citationChunkIds: string[];
};

export type StaleQuestionnaireItem = {
  questionnaireItemId: string;
  rowIndex: number | null;
};

export type ApprovedAnswerStalenessReasonCode = "FINGERPRINT_MISMATCH" | "MISSING_CHUNK";

export type ApprovedAnswerStalenessReason = {
  chunkId: string;
  reason: ApprovedAnswerStalenessReasonCode;
};

export type ApprovedAnswerStalenessDetails = {
  isStale: boolean;
  details: null | {
    affectedCitationsCount: number;
    changedCount: number;
    missingCount: number;
    reasons: ApprovedAnswerStalenessReason[];
  };
};

function summarizeStalenessReasons(reasons: ApprovedAnswerStalenessReason[]): ApprovedAnswerStalenessDetails {
  if (reasons.length === 0) {
    return {
      isStale: false,
      details: null
    };
  }

  const changedCount = reasons.filter((reason) => reason.reason === "FINGERPRINT_MISMATCH").length;
  const missingCount = reasons.filter((reason) => reason.reason === "MISSING_CHUNK").length;

  return {
    isStale: true,
    details: {
      affectedCitationsCount: reasons.length,
      changedCount,
      missingCount,
      reasons
    }
  };
}

export async function getApprovedAnswerStalenessDetails(
  approvedAnswerId: string,
  ctx: {
    orgId: string;
  }
): Promise<ApprovedAnswerStalenessDetails> {
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
    return summarizeStalenessReasons([]);
  }

  const citationChunkIds = normalizeChunkIds(approvedAnswer.citationChunkIds);
  if (citationChunkIds.length === 0) {
    return {
      isStale: false,
      details: null
    };
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

  const snapshotFingerprintByChunkId = new Map(snapshots.map((snapshot) => [snapshot.chunkId, snapshot.fingerprintAtApproval]));
  const reasonsByChunkId = new Map<string, ApprovedAnswerStalenessReason>();

  for (const chunkId of citationChunkIds) {
    if (!snapshotFingerprintByChunkId.has(chunkId)) {
      reasonsByChunkId.set(chunkId, {
        chunkId,
        reason: "MISSING_CHUNK"
      });
    }
  }

  for (const snapshot of snapshots) {
    if (!citationChunkIds.includes(snapshot.chunkId)) {
      reasonsByChunkId.set(snapshot.chunkId, {
        chunkId: snapshot.chunkId,
        reason: "MISSING_CHUNK"
      });
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
  const currentChunkById = new Map(currentChunks.map((chunk) => [chunk.id, chunk.evidenceFingerprint]));

  for (const chunkId of citationChunkIds) {
    if (reasonsByChunkId.has(chunkId)) {
      continue;
    }

    const currentFingerprint = currentChunkById.get(chunkId);
    if (!currentFingerprint) {
      reasonsByChunkId.set(chunkId, {
        chunkId,
        reason: "MISSING_CHUNK"
      });
      continue;
    }

    const snapshotFingerprint = snapshotFingerprintByChunkId.get(chunkId);
    if (!snapshotFingerprint || snapshotFingerprint !== currentFingerprint) {
      reasonsByChunkId.set(chunkId, {
        chunkId,
        reason: "FINGERPRINT_MISMATCH"
      });
    }
  }

  return summarizeStalenessReasons(Array.from(reasonsByChunkId.values()));
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
      id: true
    }
  });

  if (!approvedAnswer) {
    return true;
  }

  const staleness = await getApprovedAnswerStalenessDetails(approvedAnswerId, ctx);
  return staleness.isStale;
}

export async function findStaleApprovedAnswerIds(params: {
  orgId: string;
  approvedAnswers: ApprovedAnswerStalenessCandidate[];
}): Promise<Set<string>> {
  if (params.approvedAnswers.length === 0) {
    return new Set();
  }

  const approvedAnswers = params.approvedAnswers.map((entry) => ({
    approvedAnswerId: entry.approvedAnswerId,
    citationChunkIds: normalizeChunkIds(entry.citationChunkIds)
  }));
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

  const staleApprovedAnswerIds = new Set<string>();

  for (const approvedAnswer of approvedAnswers) {
    const citationChunkIds = approvedAnswer.citationChunkIds;
    if (citationChunkIds.length === 0) {
      continue;
    }

    const snapshotsForAnswer = snapshotsByApprovedAnswerId.get(approvedAnswer.approvedAnswerId) ?? [];
    if (snapshotsForAnswer.length !== citationChunkIds.length) {
      staleApprovedAnswerIds.add(approvedAnswer.approvedAnswerId);
      continue;
    }

    const snapshotFingerprintByChunkId = new Map(
      snapshotsForAnswer.map((snapshot) => [snapshot.chunkId, snapshot.fingerprintAtApproval])
    );
    const hasMissingSnapshotChunk = citationChunkIds.some(
      (chunkId) => !snapshotFingerprintByChunkId.has(chunkId)
    );
    if (hasMissingSnapshotChunk) {
      staleApprovedAnswerIds.add(approvedAnswer.approvedAnswerId);
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
      staleApprovedAnswerIds.add(approvedAnswer.approvedAnswerId);
    }
  }

  return staleApprovedAnswerIds;
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
  const staleApprovedAnswerIds = await findStaleApprovedAnswerIds({
    orgId: params.orgId,
    approvedAnswers
  });

  return approvedAnswers
    .filter((approvedAnswer) => staleApprovedAnswerIds.has(approvedAnswer.approvedAnswerId))
    .map((approvedAnswer) => ({
      questionnaireItemId: approvedAnswer.questionId,
      rowIndex: approvedAnswer.rowIndex ?? null
    }));
}
