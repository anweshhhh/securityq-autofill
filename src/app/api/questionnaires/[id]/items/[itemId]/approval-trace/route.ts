import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { getRequestContext } from "@/lib/requestContext";
import { getApprovalTraceForItem } from "@/server/approvedAnswers/getApprovalTrace";
import { assertCan, RbacAction } from "@/server/rbac";

type RouteContext = {
  params: {
    id: string;
    itemId: string;
  };
};

export async function GET(request: Request, context: RouteContext) {
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

    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

    const trace = await getApprovalTraceForItem(ctx, questionnaireId, itemId);
    if (!trace) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire item not found."
      });
    }

    return NextResponse.json(trace);
  } catch (error) {
    return toApiErrorResponse(error, "Failed to load approval provenance.");
  }
}
