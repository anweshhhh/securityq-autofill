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
import {
  normalizeApprovalAnswerAndCitations,
  syncApprovedAnswerEvidenceSnapshots
} from "@/server/approvedAnswers/evidenceSnapshots";
import { listApprovedAnswersForOrg, type ApprovedAnswersLibraryFreshness } from "@/server/approvedAnswers/listApprovedAnswers";
import { recordQuestionHistoryEvent } from "@/server/questionHistory/recordQuestionHistoryEvent";
import { assertCan, RbacAction } from "@/server/rbac";

type CreateApprovedAnswerBody = {
  questionId?: unknown;
  answerText?: unknown;
  citationChunkIds?: unknown;
  source?: unknown;
  approvedBy?: unknown;
  note?: unknown;
};

function parseFreshness(value: string | null): ApprovedAnswersLibraryFreshness {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "all") {
    return "ALL";
  }

  if (normalized === "stale") {
    return "STALE";
  }

  return "FRESH";
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }

  return Math.min(parsed, 20);
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

    const requestUrl = new URL(request.url);
    const q = requestUrl.searchParams.get("q");
    const freshness = parseFreshness(requestUrl.searchParams.get("freshness"));
    const limit = parseLimit(requestUrl.searchParams.get("limit"));

    const approvedAnswers = await listApprovedAnswersForOrg(ctx, {
      mode: "PICKER",
      query: q,
      freshness,
      limit
    });

    return NextResponse.json(approvedAnswers);
  } catch (error) {
    return toApiErrorResponse(error, "Failed to list approved answers.");
  }
}

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
        questionnaireId: true,
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
    const citationChunkIdsCandidate =
      payload?.citationChunkIds !== undefined
        ? normalizeCitationChunkIds(payload.citationChunkIds)
        : extractCitationChunkIds(question.citations);

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
          answerText: normalizedApproval.answerText,
          citationChunkIds: normalizedApproval.citationChunkIds,
          source,
          approvedBy,
          note
        },
        update: {
          normalizedQuestionText: questionMetadata.normalizedQuestionText,
          questionTextHash: questionMetadata.questionTextHash,
          answerText: normalizedApproval.answerText,
          citationChunkIds: normalizedApproval.citationChunkIds,
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

      await syncApprovedAnswerEvidenceSnapshots({
        db: tx,
        organizationId: ctx.orgId,
        approvedAnswerId: upserted.id,
        citationChunkIds: normalizedApproval.citationChunkIds
      });

      await tx.question.update({
        where: {
          id: question.id
        },
        data: {
          reviewStatus: "APPROVED"
        }
      });

      await recordQuestionHistoryEvent({
        db: tx,
        organizationId: ctx.orgId,
        questionnaireId: question.questionnaireId,
        questionId: question.id,
        type: "APPROVED",
        approvedAnswerId: upserted.id
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
