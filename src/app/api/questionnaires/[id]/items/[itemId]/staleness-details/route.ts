import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { getApprovedAnswerStalenessDetails } from "@/server/approvedAnswers/staleness";
import { assertCan, RbacAction } from "@/server/rbac";

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
        questionnaireId,
        questionnaire: {
          organizationId: ctx.orgId
        }
      },
      select: {
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

    if (!question.approvedAnswer) {
      return NextResponse.json({
        isStale: false,
        details: null
      });
    }

    const staleness = await getApprovedAnswerStalenessDetails(question.approvedAnswer.id, ctx);

    return NextResponse.json({
      isStale: staleness.isStale,
      details: staleness.details
        ? {
            affectedCitationsCount: staleness.details.affectedCitationsCount,
            changedCount: staleness.details.changedCount,
            missingCount: staleness.details.missingCount,
            reasons: staleness.details.reasons.map((reason) => ({
              reason: reason.reason
            }))
          }
        : null
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to load staleness details.");
  }
}
