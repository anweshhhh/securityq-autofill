import { NextResponse } from "next/server";
import { isCsvFile, parseCsvFile } from "@/lib/csv";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

function toQuestionnaireName(fileName: string, providedName?: string): string {
  if (providedName?.trim()) {
    return providedName.trim();
  }

  const withoutExtension = fileName.replace(/\.[^/.]+$/, "").trim();
  return withoutExtension || "Questionnaire";
}

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

    const parsed = await parseCsvFile(fileEntry);

    if (!questionColumn) {
      return NextResponse.json({ error: "questionColumn is required" }, { status: 400 });
    }

    if (!parsed.headers.includes(questionColumn)) {
      return NextResponse.json({ error: "Selected question column is invalid" }, { status: 400 });
    }

    const organization = await getOrCreateDefaultOrganization();

    const questionnaire = await prisma.questionnaire.create({
      data: {
        organizationId: organization.id,
        name: toQuestionnaireName(fileEntry.name, questionnaireName),
        sourceFileName: fileEntry.name,
        questionColumn,
        sourceHeaders: parsed.headers
      }
    });

    await prisma.question.createMany({
      data: parsed.rows.map((row, rowIndex) => ({
        questionnaireId: questionnaire.id,
        rowIndex,
        sourceRow: row,
        text: String(row[questionColumn] ?? "").trim(),
        citations: []
      }))
    });

    return NextResponse.json(
      {
        questionnaire: {
          id: questionnaire.id,
          name: questionnaire.name,
          questionCount: parsed.rows.length
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to import questionnaire CSV", error);
    return NextResponse.json({ error: "Failed to import questionnaire CSV" }, { status: 500 });
  }
}
