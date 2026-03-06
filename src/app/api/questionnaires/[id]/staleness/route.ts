import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { getRequestContext } from "@/lib/requestContext";
import { getQuestionnaireStaleness, ensureQuestionnaireForOrg } from "@/server/questionnaires/getQuestionnaireStaleness";
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

    const questionnaireOwned = await ensureQuestionnaireForOrg({
      questionnaireId,
      orgId: ctx.orgId
    });

    if (!questionnaireOwned) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire not found."
      });
    }

    const staleness = await getQuestionnaireStaleness(ctx, questionnaireId);
    return NextResponse.json(staleness);
  } catch (error) {
    console.error("Failed to load questionnaire staleness", error);
    return toApiErrorResponse(error, "Failed to load questionnaire staleness.");
  }
}
