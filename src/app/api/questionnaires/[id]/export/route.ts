import { NextResponse } from "next/server";
import type { Citation } from "@/lib/answering";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";
import { buildQuestionnaireExportCsv } from "@/lib/questionnaireExport";

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry == null ? "" : String(entry);
  }

  return record;
}

function toCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const citation = item as Record<string, unknown>;
      if (
        typeof citation.docName !== "string" ||
        typeof citation.chunkId !== "string" ||
        typeof citation.quotedSnippet !== "string"
      ) {
        return null;
      }

      return {
        docName: citation.docName,
        chunkId: citation.chunkId,
        quotedSnippet: citation.quotedSnippet
      };
    })
    .filter((item): item is Citation => Boolean(item));
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_");
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const questionnaireId = context.params.id;

    const questionnaire = await prisma.questionnaire.findFirst({
      where: {
        id: questionnaireId,
        organizationId: organization.id
      },
      include: {
        questions: {
          orderBy: {
            rowIndex: "asc"
          }
        }
      }
    });

    if (!questionnaire) {
      return NextResponse.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    const headers = toStringArray(questionnaire.sourceHeaders);
    const exportHeaders =
      headers.length > 0 ? headers : toStringArray(Object.keys(toStringRecord(questionnaire.questions[0]?.sourceRow)));

    const csv = buildQuestionnaireExportCsv(
      exportHeaders,
      questionnaire.questions.map((question) => ({
        sourceRow: toStringRecord(question.sourceRow),
        answer: question.answer ?? "",
        citations: toCitations(question.citations),
        confidence: question.confidence ?? "",
        needsReview: question.needsReview ?? true
      }))
    );

    const fileBase = sanitizeFileName(questionnaire.name || "questionnaire");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}-autofill.csv"`
      }
    });
  } catch (error) {
    console.error("Failed to export questionnaire", error);
    return NextResponse.json({ error: "Failed to export questionnaire" }, { status: 500 });
  }
}
