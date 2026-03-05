import { NextResponse } from "next/server";
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
            text: true
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
