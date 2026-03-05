import { NextResponse } from "next/server";
import { createEmbedding } from "@/lib/openai";
import { buildQuestionTextMetadata } from "@/lib/questionText";
import { embeddingToVectorLiteral } from "@/lib/retrieval";
import { toApiErrorResponse } from "@/lib/apiResponse";
import {
  ApiRouteError,
  assertChunkOwnership,
  extractCitationChunkIds,
  normalizeCitationChunkIds
} from "@/lib/approvalValidation";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { NOT_FOUND_TEXT } from "@/shared/answerTemplates";
import { assertCan, RbacAction } from "@/server/rbac";

type CreateApprovedAnswerBody = {
  questionId?: unknown;
  answerText?: unknown;
  citationChunkIds?: unknown;
  source?: unknown;
  approvedBy?: unknown;
  note?: unknown;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as CreateApprovedAnswerBody | null;
    const questionId = typeof payload?.questionId === "string" ? payload.questionId.trim() : "";

    if (!questionId) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "questionId is required."
      });
    }

    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.APPROVE_ANSWERS);
    const question = await prisma.question.findFirst({
      where: {
        id: questionId,
        questionnaire: {
          organizationId: ctx.orgId
        }
      },
      select: {
        id: true,
        text: true,
        answer: true,
        citations: true
      }
    });

    if (!question) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Question not found."
      });
    }

    const answerTextCandidate =
      typeof payload?.answerText === "string" ? payload.answerText.trim() : (question.answer ?? "").trim();
    if (!answerTextCandidate || answerTextCandidate === NOT_FOUND_TEXT) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Cannot approve an empty or not-found answer."
      });
    }

    const citationChunkIdsCandidate =
      payload?.citationChunkIds !== undefined
        ? normalizeCitationChunkIds(payload.citationChunkIds)
        : extractCitationChunkIds(question.citations);

    if (citationChunkIdsCandidate.length === 0) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "citationChunkIds must be non-empty."
      });
    }

    await assertChunkOwnership({
      organizationId: ctx.orgId,
      chunkIds: citationChunkIdsCandidate
    });

    const source =
      payload?.source === "MANUAL_EDIT" || payload?.source === "GENERATED"
        ? payload.source
        : "GENERATED";
    const approvedBy = typeof payload?.approvedBy === "string" ? payload.approvedBy.trim() || "system" : "system";
    const note = typeof payload?.note === "string" ? payload.note.trim() || null : null;
    const questionMetadata = buildQuestionTextMetadata(question.text);
    const questionEmbedding = await createEmbedding(question.text);

    const approvedAnswer = await prisma.$transaction(async (tx) => {
      const upserted = await tx.approvedAnswer.upsert({
        where: {
          questionId: question.id
        },
        create: {
          organizationId: ctx.orgId,
          questionId: question.id,
          normalizedQuestionText: questionMetadata.normalizedQuestionText,
          questionTextHash: questionMetadata.questionTextHash,
          answerText: answerTextCandidate,
          citationChunkIds: citationChunkIdsCandidate,
          source,
          approvedBy,
          note
        },
        update: {
          normalizedQuestionText: questionMetadata.normalizedQuestionText,
          questionTextHash: questionMetadata.questionTextHash,
          answerText: answerTextCandidate,
          citationChunkIds: citationChunkIdsCandidate,
          source,
          approvedBy,
          note
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
        upserted.id
      );

      await tx.question.update({
        where: {
          id: question.id
        },
        data: {
          reviewStatus: "APPROVED"
        }
      });

      return upserted;
    });

    return NextResponse.json({
      approvedAnswer
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to create approved answer.");
  }
}
