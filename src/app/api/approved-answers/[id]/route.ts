import { NextResponse } from "next/server";
import { jsonError } from "@/lib/apiResponse";
import { ApiRouteError, assertChunkOwnership, normalizeCitationChunkIds } from "@/lib/approvalValidation";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { createEmbedding } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { getRequestContext } from "@/lib/requestContext";
import { embeddingToVectorLiteral } from "@/lib/retrieval";
import {
  normalizeApprovalAnswerAndCitations,
  syncApprovedAnswerEvidenceSnapshots
} from "@/server/approvedAnswers/evidenceSnapshots";
import { getApprovedAnswerLibraryDetail } from "@/server/approvedAnswers/getApprovedAnswerLibraryDetail";
import { isApprovedAnswerStale } from "@/server/approvedAnswers/staleness";
import { recordQuestionHistoryEvent } from "@/server/questionHistory/recordQuestionHistoryEvent";
import { assertCan, RbacAction } from "@/server/rbac";

type RouteContext = {
  params: {
    id: string;
  };
};

type UpdateApprovedAnswerBody = {
  answerText?: unknown;
  citationChunkIds?: unknown;
  note?: unknown;
  approvedBy?: unknown;
};

type ApprovedAnswerCitation = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const approvedAnswerId = context.params.id.trim();
    const requestUrl = new URL(_request.url);
    const isLibraryDetailRequest = requestUrl.searchParams.get("detail") === "library";

    if (!approvedAnswerId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Approved answer ID is required."
      });
    }

    const ctx = await getRequestContext(_request);
    assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

    if (isLibraryDetailRequest) {
      const detail = await getApprovedAnswerLibraryDetail(ctx, approvedAnswerId);
      if (!detail) {
        throw new ApiRouteError({
          status: 404,
          code: "NOT_FOUND",
          message: "Approved answer not found."
        });
      }

      return NextResponse.json(detail);
    }

    const approvedAnswer = await prisma.approvedAnswer.findFirst({
      where: {
        id: approvedAnswerId,
        organizationId: ctx.orgId
      },
      select: {
        id: true,
        answerText: true,
        citationChunkIds: true
      }
    });

    if (!approvedAnswer) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Approved answer not found."
      });
    }

    const isStale = await isApprovedAnswerStale(approvedAnswer.id, {
      orgId: ctx.orgId
    });
    if (isStale) {
      return jsonError({
        status: 409,
        code: "STALE_APPROVED_ANSWER",
        message: "Approved answer is stale and cannot be applied."
      });
    }

    const citationChunkIds = Array.from(
      new Set(
        approvedAnswer.citationChunkIds
          .map((chunkId) => chunkId.trim())
          .filter((chunkId) => chunkId.length > 0)
      )
    );

    const citations = citationChunkIds.length
      ? await prisma.documentChunk.findMany({
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
            content: true,
            document: {
              select: {
                name: true
              }
            }
          }
        })
      : [];

    const citationByChunkId = new Map(
      citations.map((chunk) => [
        chunk.id,
        {
          chunkId: chunk.id,
          docName: chunk.document.name,
          quotedSnippet: chunk.content
        }
      ])
    );

    const orderedCitations = citationChunkIds
      .map((chunkId) => citationByChunkId.get(chunkId))
      .filter((citation): citation is ApprovedAnswerCitation => Boolean(citation));

    return NextResponse.json({
      answerText: approvedAnswer.answerText,
      citations: orderedCitations
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to load approved answer.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.EDIT_APPROVED_ANSWERS);
    const approvedAnswerId = context.params.id.trim();

    if (!approvedAnswerId) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Approved answer ID is required."
      });
    }

    const existing = await prisma.approvedAnswer.findFirst({
      where: {
        id: approvedAnswerId,
        organizationId: ctx.orgId
      },
      select: {
        id: true,
        questionId: true,
        answerText: true,
        citationChunkIds: true,
        note: true,
        approvedBy: true,
        question: {
          select: {
            text: true,
            questionnaireId: true
          }
        }
      }
    });

    if (!existing) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Approved answer not found."
      });
    }

    const payload = (await request.json().catch(() => null)) as UpdateApprovedAnswerBody | null;
    const answerTextCandidate =
      typeof payload?.answerText === "string" ? payload.answerText.trim() : existing.answerText;
    const citationChunkIdsCandidate =
      payload?.citationChunkIds !== undefined
        ? normalizeCitationChunkIds(payload.citationChunkIds)
        : existing.citationChunkIds;
    const note = typeof payload?.note === "string" ? payload.note.trim() || null : existing.note;
    const approvedBy =
      typeof payload?.approvedBy === "string" ? payload.approvedBy.trim() || "system" : (existing.approvedBy ?? "system");

    const normalizedApproval = normalizeApprovalAnswerAndCitations({
      answerText: answerTextCandidate,
      citationChunkIds: citationChunkIdsCandidate
    });

    if (normalizedApproval.citationChunkIds.length > 0) {
      await assertChunkOwnership({
        organizationId: ctx.orgId,
        chunkIds: normalizedApproval.citationChunkIds
      });
    }
    const questionMetadata = buildQuestionTextMetadata(existing.question.text);
    const questionEmbedding = await createEmbedding(existing.question.text);

    const approvedAnswer = await prisma.$transaction(async (tx) => {
      const updated = await tx.approvedAnswer.update({
        where: {
          id: existing.id
        },
        data: {
          normalizedQuestionText: questionMetadata.normalizedQuestionText,
          questionTextHash: questionMetadata.questionTextHash,
          answerText: normalizedApproval.answerText,
          citationChunkIds: normalizedApproval.citationChunkIds,
          source: "MANUAL_EDIT",
          note,
          approvedBy
        }
      });

      await tx.$executeRawUnsafe(
        `
          UPDATE "ApprovedAnswer"
          SET
            "questionEmbedding" = $1::vector(1536),
            "normalizedQuestionText" = $2,
            "questionTextHash" = $3
          WHERE "id" = $4
        `,
        embeddingToVectorLiteral(questionEmbedding),
        questionMetadata.normalizedQuestionText,
        questionMetadata.questionTextHash,
        updated.id
      );

      await syncApprovedAnswerEvidenceSnapshots({
        db: tx,
        organizationId: ctx.orgId,
        approvedAnswerId: updated.id,
        citationChunkIds: normalizedApproval.citationChunkIds
      });

      await tx.question.update({
        where: {
          id: existing.questionId
        },
        data: {
          reviewStatus: "APPROVED"
        }
      });

      await recordQuestionHistoryEvent({
        db: tx,
        organizationId: ctx.orgId,
        questionnaireId: existing.question.questionnaireId,
        questionId: existing.questionId,
        type: "APPROVED",
        approvedAnswerId: updated.id
      });

      return updated;
    });

    return NextResponse.json({
      approvedAnswer
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to update approved answer.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const ctx = await getRequestContext(_request);
    assertCan(ctx.role, RbacAction.APPROVE_ANSWERS);
    const approvedAnswerId = context.params.id.trim();

    if (!approvedAnswerId) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Approved answer ID is required."
      });
    }

    const existing = await prisma.approvedAnswer.findFirst({
      where: {
        id: approvedAnswerId,
        organizationId: ctx.orgId
      },
      select: {
        id: true,
        questionId: true
      }
    });

    if (!existing) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Approved answer not found."
      });
    }

    await prisma.$transaction([
      prisma.approvedAnswer.delete({
        where: {
          id: existing.id
        }
      }),
      prisma.question.update({
        where: {
          id: existing.questionId
        },
        data: {
          reviewStatus: "DRAFT"
        }
      })
    ]);

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to update approved answer.");
  }
}
