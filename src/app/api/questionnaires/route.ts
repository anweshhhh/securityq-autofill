import { NextResponse } from "next/server";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { listQuestionnairesForOrganization } from "@/lib/questionnaireService";
import { getRequestContext } from "@/lib/requestContext";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    const questionnaires = await listQuestionnairesForOrganization(ctx.orgId);

    return NextResponse.json({
      questionnaires
    });
  } catch (error) {
    console.error("Failed to list questionnaires", error);
    return toApiErrorResponse(error, "Failed to list questionnaires.");
  }
}
