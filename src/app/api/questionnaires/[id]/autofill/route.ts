import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { getEmbeddingAvailability, processQuestionnaireAutofillBatch } from "@/lib/questionnaireService";

export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const availability = await getEmbeddingAvailability(organization.id);

    if (availability.total === 0 || availability.embedded === 0) {
      return NextResponse.json(
        {
          error: "No embedded chunks found. Upload documents and run /api/documents/embed first."
        },
        { status: 409 }
      );
    }

    if (availability.missing > 0) {
      return NextResponse.json(
        {
          error:
            "Some document chunks are missing embeddings. Run /api/documents/embed and retry autofill."
        },
        { status: 409 }
      );
    }

    const progress = await processQuestionnaireAutofillBatch({
      organizationId: organization.id,
      questionnaireId: context.params.id
    });

    return NextResponse.json(progress);
  } catch (error) {
    console.error("Failed to autofill questionnaire", error);

    if (error instanceof Error && error.message === "Questionnaire not found") {
      return NextResponse.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to autofill questionnaire" }, { status: 500 });
  }
}
