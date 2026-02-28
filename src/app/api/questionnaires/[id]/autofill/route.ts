import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { getEmbeddingAvailability, processQuestionnaireAutofillBatch } from "@/lib/questionnaireService";
import { getRequestContext } from "@/lib/requestContext";

export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const isDevMode = process.env.DEV_MODE === "true";
    const url = new URL(_request.url);
    let debugRequested = url.searchParams.get("debug") === "true";
    if (!debugRequested && _request.headers.get("content-type")?.includes("application/json")) {
      const payload = (await _request.json().catch(() => null)) as { debug?: boolean } | null;
      debugRequested = payload?.debug === true;
    }
    const questionnaireId = context.params.id.trim();
    if (!questionnaireId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Questionnaire ID is required."
      });
    }

    const debug = isDevMode && debugRequested;
    const ctx = await getRequestContext(_request);
    const availability = await getEmbeddingAvailability(ctx.orgId);

    if (availability.total === 0 || availability.embedded === 0) {
      return jsonError({
        status: 409,
        code: "CONFLICT",
        message: "No embedded chunks found. Upload documents and run /api/documents/embed first."
      });
    }

    if (availability.missing > 0) {
      return jsonError({
        status: 409,
        code: "CONFLICT",
        message: "Some document chunks are missing embeddings. Run /api/documents/embed and retry autofill."
      });
    }

    const progress = await processQuestionnaireAutofillBatch({
      organizationId: ctx.orgId,
      questionnaireId,
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
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Questionnaire not found."
      });
    }

    return toApiErrorResponse(error, "Failed to autofill questionnaire.");
  }
}
