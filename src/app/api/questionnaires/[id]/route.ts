import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { deleteQuestionnaire, getQuestionnaireDetails } from "@/lib/questionnaireService";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const details = await getQuestionnaireDetails(organization.id, context.params.id);

    if (!details) {
      return NextResponse.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    return NextResponse.json(details);
  } catch (error) {
    console.error("Failed to load questionnaire details", error);
    return NextResponse.json({ error: "Failed to load questionnaire details" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const deleted = await deleteQuestionnaire(organization.id, context.params.id);

    if (!deleted) {
      return NextResponse.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete questionnaire", error);
    return NextResponse.json({ error: "Failed to delete questionnaire" }, { status: 500 });
  }
}
