import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { getRequestContext } from "@/lib/requestContext";
import { getReuseSuggestionsForQuestion } from "@/server/approvedAnswers/getReuseSuggestions";
import { assertCan, RbacAction } from "@/server/rbac";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: {
    id: string;
    itemId: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const questionnaireId = context.params.id.trim();
    const itemId = context.params.itemId.trim();

    if (!questionnaireId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Questionnaire ID is required."
      });
    }

    if (!itemId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Questionnaire item ID is required."
      });
    }

    const ctx = await getRequestContext(_request);
    assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

    const question = await prisma.question.findFirst({
      where: {
        id: itemId,
        questionnaire: {
          id: questionnaireId,
          organizationId: ctx.orgId
        }
      },
      select: {
        id: true,
        text: true,
        approvedAnswer: {
          select: {
            id: true
          }
        }
      }
    });

    if (!question) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire item not found."
      });
    }

    const suggestions = await getReuseSuggestionsForQuestion({
      orgId: ctx.orgId,
      questionText: question.text,
      excludeApprovedAnswerId: question.approvedAnswer?.id ?? null,
      limit: 3
    });

    const payload = {
      suggestions: suggestions.map((suggestion) => ({
        approvedAnswerId: suggestion.approvedAnswerId,
        answerText: suggestion.answerText,
        citationsCount: suggestion.citationChunkIds.length,
        similarity: suggestion.similarity
      }))
    };

    return NextResponse.json(payload);
  } catch (error) {
    return toApiErrorResponse(error, "Failed to load reuse suggestions.");
  }
}
