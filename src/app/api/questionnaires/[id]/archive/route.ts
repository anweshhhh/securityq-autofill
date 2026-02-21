import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { archiveQuestionnaire } from "@/lib/questionnaireService";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const archived = await archiveQuestionnaire(organization.id, context.params.id);

    if (!archived) {
      return NextResponse.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to archive questionnaire", error);
    return NextResponse.json({ error: "Failed to archive questionnaire" }, { status: 500 });
  }
}
