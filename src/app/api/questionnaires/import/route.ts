import { NextResponse } from "next/server";
import { isCsvFile } from "@/lib/csv";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { importQuestionnaireFromCsv } from "@/lib/questionnaireService";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const questionColumn = String(formData.get("questionColumn") ?? "").trim();
    const questionnaireName = String(formData.get("name") ?? "");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (!isCsvFile(fileEntry)) {
      return NextResponse.json({ error: "Only .csv files are supported" }, { status: 400 });
    }

    if (!questionColumn) {
      return NextResponse.json({ error: "questionColumn is required" }, { status: 400 });
    }

    const organization = await getOrCreateDefaultOrganization();
    const result = await importQuestionnaireFromCsv({
      organizationId: organization.id,
      file: fileEntry,
      questionColumn,
      questionnaireName
    });

    return NextResponse.json(
      {
        questionnaire: {
          id: result.questionnaire.id,
          name: result.questionnaire.name,
          questionCount: result.questionCount
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to import questionnaire CSV", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import questionnaire CSV" },
      { status: 400 }
    );
  }
}
