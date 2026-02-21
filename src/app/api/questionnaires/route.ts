import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { listQuestionnairesForOrganization } from "@/lib/questionnaireService";

export async function GET() {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const questionnaires = await listQuestionnairesForOrganization(organization.id);

    return NextResponse.json({
      questionnaires
    });
  } catch (error) {
    console.error("Failed to list questionnaires", error);
    return NextResponse.json({ error: "Failed to list questionnaires" }, { status: 500 });
  }
}
