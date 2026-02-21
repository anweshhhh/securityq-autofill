import { NextResponse } from "next/server";
import { buildCsvPreview, isCsvFile, parseCsvFile } from "@/lib/csv";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (!isCsvFile(fileEntry)) {
      return NextResponse.json({ error: "Only .csv files are supported" }, { status: 400 });
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read CSV headers" },
      { status: 400 }
    );
  }
}
