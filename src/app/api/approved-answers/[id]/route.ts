import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { ApiRouteError, assertChunkOwnership, normalizeCitationChunkIds } from "@/lib/approvalValidation";
import { createEmbedding } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { embeddingToVectorLiteral } from "@/lib/retrieval";

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

function buildErrorResponse(error: ApiRouteError | Error) {
  if (error instanceof ApiRouteError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to update approved answer."
      }
    },
    { status: 500 }
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
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
        organizationId: organization.id
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
    const answerText =
      typeof payload?.answerText === "string" ? payload.answerText.trim() : existing.answerText;
    const citationChunkIds =
      payload?.citationChunkIds !== undefined
        ? normalizeCitationChunkIds(payload.citationChunkIds)
        : existing.citationChunkIds;
    const note = typeof payload?.note === "string" ? payload.note.trim() || null : existing.note;
    const approvedBy =
      typeof payload?.approvedBy === "string" ? payload.approvedBy.trim() || "system" : (existing.approvedBy ?? "system");

    if (!answerText) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "answerText must be non-empty."
      });
    }

    if (citationChunkIds.length === 0) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "citationChunkIds must be non-empty."
      });
    }

    await assertChunkOwnership({
      organizationId: organization.id,
      chunkIds: citationChunkIds
    });
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
          answerText,
          citationChunkIds,
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
    return buildErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
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
        organizationId: organization.id
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
    return buildErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
