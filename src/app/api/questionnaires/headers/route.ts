import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { buildCsvPreview, isCsvFile, parseCsvFile } from "@/lib/csv";
import { getRequestContext, RequestContextError } from "@/lib/requestContext";

export async function POST(request: Request) {
  try {
    await getRequestContext(request);

    const formData = await request.formData();
    const fileEntry = formData.get("file");

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

    const parsed = await parseCsvFile(fileEntry);
    const preview = buildCsvPreview(parsed);

    return NextResponse.json({
      headers: preview.headers,
      rowCount: preview.totalRowCount,
      previewRows: preview.previewRows,
      suggestedQuestionColumn: preview.suggestedQuestionColumn
    });
  } catch (error) {
    console.error("Failed to read CSV headers", error);
    if (error instanceof RequestContextError) {
      return toApiErrorResponse(error, "Failed to read CSV headers.");
    }

    return jsonError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: error instanceof Error ? error.message : "Failed to read CSV headers."
    });
  }
}
