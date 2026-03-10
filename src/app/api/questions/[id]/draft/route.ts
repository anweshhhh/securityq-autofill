import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/approvalValidation";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { recordQuestionHistoryEvent } from "@/server/questionHistory/recordQuestionHistoryEvent";
import { assertCan, RbacAction } from "@/server/rbac";
import { normalizeTemplateText, NOT_FOUND_TEXT } from "@/shared/answerTemplates";

type RouteContext = {
  params: {
    id: string;
  };
};

type DraftAnswerBody = {
  answerText?: unknown;
  citationChunkIds?: unknown;
  citations?: unknown;
  draftSource?: unknown;
};

type PersistedCitation = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
};

function normalizeChunkIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    )
  );
}

function extractChunkIdsFromCitations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return "";
          }

          const typed = entry as { chunkId?: unknown };
          return typeof typed.chunkId === "string" ? typed.chunkId.trim() : "";
        })
        .filter((entry) => entry.length > 0)
    )
  );
}

function citationChunkIdsFromPayload(payload: DraftAnswerBody | null): string[] {
  const explicitChunkIds = normalizeChunkIds(payload?.citationChunkIds);
  if (explicitChunkIds.length > 0) {
    return explicitChunkIds;
  }

  return extractChunkIdsFromCitations(payload?.citations);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const questionId = context.params.id.trim();
    if (!questionId) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Question ID is required."
      });
    }

    const payload = (await request.json().catch(() => null)) as DraftAnswerBody | null;
    const answerText =
      typeof payload?.answerText === "string" ? normalizeTemplateText(payload.answerText) : "";

    if (!answerText) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "answerText is required."
      });
    }

    const citationChunkIds = citationChunkIdsFromPayload(payload);
    const draftSuggestionApplied = payload?.draftSource === "SUGGESTION_APPLY";
    if (answerText === NOT_FOUND_TEXT && citationChunkIds.length > 0) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "NOT_FOUND drafts must not include citations."
      });
    }

    if (answerText !== NOT_FOUND_TEXT && citationChunkIds.length === 0) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "citationChunkIds must be non-empty for non-NOT_FOUND drafts."
      });
    }

    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.MARK_NEEDS_REVIEW);

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
        approvedAnswer: {
          select: {
            id: true
          }
        }
      }
    });

    if (!question) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Question not found."
      });
    }

    if (question.approvedAnswer) {
      return jsonError({
        status: 409,
        code: "QUESTION_ALREADY_APPROVED",
        message: "Approved questions must be unapproved before applying a suggestion."
      });
    }

    const chunks = citationChunkIds.length
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

    if (chunks.length !== citationChunkIds.length) {
      const resolvedChunkIds = new Set(chunks.map((chunk) => chunk.id));
      const invalidChunkIds = citationChunkIds.filter((chunkId) => !resolvedChunkIds.has(chunkId));
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "One or more citationChunkIds are invalid for this organization.",
        details: {
          invalidChunkIds
        }
      });
    }

    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const citations: PersistedCitation[] = citationChunkIds
      .map((chunkId) => {
        const chunk = chunkById.get(chunkId);
        if (!chunk) {
          return null;
        }

        return {
          chunkId,
          docName: chunk.document.name,
          quotedSnippet: chunk.content
        };
      })
      .filter((citation): citation is PersistedCitation => citation !== null);

    const updated = await prisma.$transaction(async (tx) => {
      const nextQuestion = await tx.question.update({
        where: {
          id: question.id
        },
        data: {
          answer: answerText,
          citations,
          reviewStatus: "NEEDS_REVIEW",
          draftSuggestionApplied,
          reusedFromApprovedAnswerId: null,
          reuseMatchType: null,
          reusedAt: null
        },
        select: {
          id: true,
          answer: true,
          citations: true,
          reviewStatus: true
        }
      });

      await recordQuestionHistoryEvent({
        db: tx,
        organizationId: ctx.orgId,
        questionnaireId: question.questionnaireId,
        questionId: question.id,
        type: draftSuggestionApplied ? "SUGGESTION_APPLIED" : "DRAFT_UPDATED"
      });

      return nextQuestion;
    });

    return NextResponse.json({
      question: updated
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to save draft answer.");
  }
}
