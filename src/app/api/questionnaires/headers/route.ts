import { NextResponse } from "next/server";
import { isCsvFile, parseCsvFile, suggestQuestionColumn } from "@/lib/csv";

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

    return NextResponse.json({
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      suggestedQuestionColumn: suggestQuestionColumn(parsed.headers)
    });
  } catch (error) {
    console.error("Failed to read CSV headers", error);
    return NextResponse.json({ error: "Failed to read CSV headers" }, { status: 400 });
  }
}
