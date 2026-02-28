import { NextResponse } from "next/server";
import { ApiRouteError, extractCitationChunkIds } from "@/lib/approvalValidation";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";

const NOT_FOUND_ANSWER = "Not found in provided documents.";

type RouteContext = {
  params: {
    id: string;
  };
};

type ApproveReusedBody = {
  mode?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const questionnaireId = context.params.id.trim();
    if (!questionnaireId) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Questionnaire ID is required."
      });
    }

    const payload = (await request.json().catch(() => null)) as ApproveReusedBody | null;
    const mode = payload?.mode === "exactOnly" ? payload.mode : null;
    if (!mode) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "mode must be exactOnly."
      });
    }

    const ctx = await getRequestContext(request);
    const questionnaire = await prisma.questionnaire.findFirst({
      where: {
        id: questionnaireId,
        organizationId: ctx.orgId
      },
      select: {
        id: true
      }
    });

    if (!questionnaire) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire not found."
      });
    }

    const exactReusedQuestions = await prisma.question.findMany({
      where: {
        questionnaireId: questionnaire.id,
        reuseMatchType: "EXACT",
        reusedFromApprovedAnswerId: {
          not: null
        }
      },
      select: {
        id: true,
        answer: true,
        citations: true,
        reviewStatus: true
      }
    });

    const approvableCandidates: Array<{ id: string; citationChunkIds: string[]; alreadyApproved: boolean }> = [];
    let skippedNotFoundOrEmpty = 0;
    let skippedInvalidCitations = 0;

    for (const question of exactReusedQuestions) {
      const answerText = (question.answer ?? "").trim();
      if (!answerText || answerText === NOT_FOUND_ANSWER) {
        skippedNotFoundOrEmpty += 1;
        continue;
      }

      const citationChunkIds = extractCitationChunkIds(question.citations);
      if (citationChunkIds.length === 0) {
        skippedInvalidCitations += 1;
        continue;
      }

      approvableCandidates.push({
        id: question.id,
        citationChunkIds,
        alreadyApproved: question.reviewStatus === "APPROVED"
      });
    }

    const allChunkIds = Array.from(
      new Set(approvableCandidates.flatMap((candidate) => candidate.citationChunkIds))
    );
    const ownedChunks =
      allChunkIds.length === 0
        ? []
        : await prisma.documentChunk.findMany({
            where: {
              id: {
                in: allChunkIds
              },
              document: {
                organizationId: ctx.orgId
              }
            },
            select: {
              id: true
            }
          });
    const ownedChunkIdSet = new Set(ownedChunks.map((chunk) => chunk.id));

    let alreadyApprovedCount = 0;
    const questionIdsToApprove: string[] = [];
    for (const candidate of approvableCandidates) {
      const allOwned = candidate.citationChunkIds.every((chunkId) => ownedChunkIdSet.has(chunkId));
      if (!allOwned) {
        skippedInvalidCitations += 1;
        continue;
      }

      if (candidate.alreadyApproved) {
        alreadyApprovedCount += 1;
        continue;
      }

      questionIdsToApprove.push(candidate.id);
    }

    if (questionIdsToApprove.length > 0) {
      await prisma.question.updateMany({
        where: {
          questionnaireId: questionnaire.id,
          id: {
            in: questionIdsToApprove
          }
        },
        data: {
          reviewStatus: "APPROVED"
        }
      });
    }

    return NextResponse.json({
      ok: true,
      mode,
      exactReusedCount: exactReusedQuestions.length,
      approvedCount: questionIdsToApprove.length,
      alreadyApprovedCount,
      skippedCount: skippedNotFoundOrEmpty + skippedInvalidCitations,
      skippedNotFoundOrEmpty,
      skippedInvalidCitations
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to approve reused answers.");
  }
}
