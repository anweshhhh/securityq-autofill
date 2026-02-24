import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { getEmbeddingAvailability, processQuestionnaireAutofillBatch } from "@/lib/questionnaireService";

export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const isDevMode = process.env.DEV_MODE === "true";
    const url = new URL(_request.url);
    let debugRequested = url.searchParams.get("debug") === "true";
    if (!debugRequested && _request.headers.get("content-type")?.includes("application/json")) {
      const payload = (await _request.json().catch(() => null)) as { debug?: boolean } | null;
      debugRequested = payload?.debug === true;
    }
    const debug = isDevMode && debugRequested;
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
      questionnaireId: context.params.id,
      debug
    });

    if (!isDevMode && progress && typeof progress === "object" && "debug" in progress) {
      const { debug: _debug, ...withoutDebug } = progress as typeof progress & { debug?: unknown };
      return NextResponse.json(withoutDebug);
    }

    return NextResponse.json(progress);
  } catch (error) {
    console.error("Failed to autofill questionnaire", error);

    if (error instanceof Error && error.message === "Questionnaire not found") {
      return NextResponse.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to autofill questionnaire" }, { status: 500 });
  }
}
