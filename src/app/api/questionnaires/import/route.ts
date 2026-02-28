import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { isCsvFile } from "@/lib/csv";
import { importQuestionnaireFromCsv } from "@/lib/questionnaireService";
import { getRequestContext, RequestContextError } from "@/lib/requestContext";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const questionColumn = String(formData.get("questionColumn") ?? "").trim();
    const questionnaireName = String(formData.get("name") ?? "");

    if (!(fileEntry instanceof File)) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "file is required."
      });
    }

    if (!isCsvFile(fileEntry)) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Only .csv files are supported."
      });
    }

    if (!questionColumn) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "questionColumn is required."
      });
    }

    const ctx = await getRequestContext(request);
    const result = await importQuestionnaireFromCsv({
      organizationId: ctx.orgId,
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
    if (error instanceof RequestContextError) {
      return toApiErrorResponse(error, "Failed to import questionnaire CSV.");
    }

    return jsonError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: error instanceof Error ? error.message : "Failed to import questionnaire CSV."
    });
  }
}
