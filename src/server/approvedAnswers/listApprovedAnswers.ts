import { prisma } from "@/lib/prisma";
import { findStaleApprovedAnswerIds } from "@/server/approvedAnswers/staleness";

export type ApprovedAnswersLibraryFreshness = "ALL" | "FRESH" | "STALE";
export type ApprovedAnswersListMode = "LIBRARY" | "PICKER";

export type ApprovedAnswersLibraryRow = {
  approvedAnswerId: string;
  answerPreview: string;
  approvedAt: string;
  freshness: "FRESH" | "STALE";
  snapshottedCitationsCount: number;
  reused: boolean;
  suggestionAssisted: boolean;
  sourceQuestionnaireId: string | null;
  sourceItemId: string | null;
};

export type ApprovedAnswersLibraryResult = {
  rows: ApprovedAnswersLibraryRow[];
  counts: {
    total: number;
    fresh: number;
    stale: number;
  };
};

function normalizeFreshness(value?: string | null): ApprovedAnswersLibraryFreshness {
  if (value === "FRESH" || value === "STALE" || value === "ALL") {
    return value;
  }

  return "ALL";
}

function normalizeQuery(value?: string | null): string {
  return (value ?? "").trim();
}

function buildAnswerPreview(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217).trimEnd()}...`;
}

export async function listApprovedAnswersForOrg(
  ctx: {
    orgId: string;
  },
  params?: {
    query?: string | null;
    freshness?: ApprovedAnswersLibraryFreshness | string | null;
    limit?: number;
    mode?: ApprovedAnswersListMode | null;
  }
): Promise<ApprovedAnswersLibraryResult> {
  const mode = params?.mode === "PICKER" ? "PICKER" : "LIBRARY";
  const query = normalizeQuery(params?.query);
  const freshness = normalizeFreshness(params?.freshness ?? (mode === "PICKER" ? "FRESH" : "ALL"));
  const defaultLimit = mode === "PICKER" ? 20 : 50;
  const maxLimit = mode === "PICKER" ? 20 : 100;
  const limit = Math.max(1, Math.min(params?.limit ?? defaultLimit, maxLimit));

  const approvedAnswers = await prisma.approvedAnswer.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(query
        ? {
            OR: [
              {
                answerText: {
                  contains: query,
                  mode: "insensitive"
                }
              },
              {
                question: {
                  text: {
                    contains: query,
                    mode: "insensitive"
                  }
                }
              }
            ]
          }
        : {})
    },
    orderBy: [
      {
        updatedAt: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    select: {
      id: true,
      answerText: true,
      createdAt: true,
      citationChunkIds: true,
      question: {
        select: {
          id: true,
          questionnaireId: true,
          reusedFromApprovedAnswerId: true,
          draftSuggestionApplied: true
        }
      }
    }
  });

  if (approvedAnswers.length === 0) {
    return {
      rows: [],
      counts: {
        total: 0,
        fresh: 0,
        stale: 0
      }
    };
  }

  const approvedAnswerIds = approvedAnswers.map((approvedAnswer) => approvedAnswer.id);
  const [snapshotCounts, staleApprovedAnswerIds] = await Promise.all([
    prisma.approvedAnswerEvidence.groupBy({
      by: ["approvedAnswerId"],
      where: {
        approvedAnswerId: {
          in: approvedAnswerIds
        }
      },
      _count: {
        _all: true
      }
    }),
    findStaleApprovedAnswerIds({
      orgId: ctx.orgId,
      approvedAnswers: approvedAnswers.map((approvedAnswer) => ({
        approvedAnswerId: approvedAnswer.id,
        citationChunkIds: approvedAnswer.citationChunkIds
      }))
    })
  ]);

  const snapshotCountByApprovedAnswerId = new Map(
    snapshotCounts.map((entry) => [entry.approvedAnswerId, entry._count._all])
  );

  const allRows = approvedAnswers.map<ApprovedAnswersLibraryRow>((approvedAnswer) => {
    const isStale = staleApprovedAnswerIds.has(approvedAnswer.id);

    return {
      approvedAnswerId: approvedAnswer.id,
      answerPreview: buildAnswerPreview(approvedAnswer.answerText),
      approvedAt: approvedAnswer.createdAt.toISOString(),
      freshness: isStale ? "STALE" : "FRESH",
      snapshottedCitationsCount: snapshotCountByApprovedAnswerId.get(approvedAnswer.id) ?? 0,
      reused: Boolean(approvedAnswer.question.reusedFromApprovedAnswerId),
      suggestionAssisted: approvedAnswer.question.draftSuggestionApplied,
      sourceQuestionnaireId: approvedAnswer.question.questionnaireId,
      sourceItemId: approvedAnswer.question.id
    };
  });

  const filteredRows =
    freshness === "ALL" ? allRows : allRows.filter((row) => row.freshness === freshness);

  return {
    rows: filteredRows.slice(0, limit),
    counts: {
      total: filteredRows.length,
      fresh: filteredRows.filter((row) => row.freshness === "FRESH").length,
      stale: filteredRows.filter((row) => row.freshness === "STALE").length
    }
  };
}
