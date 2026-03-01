import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { deleteQuestionnaire, getQuestionnaireDetails } from "@/lib/questionnaireService";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const questionnaireId = context.params.id.trim();
    if (!questionnaireId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Questionnaire ID is required."
      });
    }

    const ctx = await getRequestContext(_request);
    assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);
    const details = await getQuestionnaireDetails(ctx.orgId, questionnaireId);

    if (!details) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire not found."
      });
    }

    return NextResponse.json(details);
  } catch (error) {
    console.error("Failed to load questionnaire details", error);
    return toApiErrorResponse(error, "Failed to load questionnaire details.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const questionnaireId = context.params.id.trim();
    if (!questionnaireId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Questionnaire ID is required."
      });
    }

    const ctx = await getRequestContext(_request);
    assertCan(ctx.role, RbacAction.DELETE_QUESTIONNAIRES);
    const deleted = await deleteQuestionnaire(ctx.orgId, questionnaireId);

    if (!deleted) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire not found."
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete questionnaire", error);
    return toApiErrorResponse(error, "Failed to delete questionnaire.");
  }
}
