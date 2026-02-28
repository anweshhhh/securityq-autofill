import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { answerQuestion } from "@/server/answerEngine";
import { getRequestContext } from "@/lib/requestContext";

export async function POST(request: Request) {
  try {
    const isDevMode = process.env.DEV_MODE === "true";
    const url = new URL(request.url);
    const debugFromQuery = url.searchParams.get("debug") === "true";
    const payload = (await request.json()) as { question?: string; debug?: boolean };
    const question = payload.question?.trim();
    const debugRequested = debugFromQuery || payload.debug === true;
    const debug = isDevMode && debugRequested;

    if (!question) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "question is required."
      });
    }

    const ctx = await getRequestContext(request);
    const answer = await answerQuestion({
      orgId: ctx.orgId,
      questionText: question,
      debug
    });

    if (!isDevMode && answer && typeof answer === "object" && "debug" in answer) {
      const { debug: _debug, ...withoutDebug } = answer as typeof answer & { debug?: unknown };
      return NextResponse.json(withoutDebug);
    }

    return NextResponse.json(answer);
  } catch (error) {
    console.error("Failed to answer question", error);
    return toApiErrorResponse(error, "Failed to answer question.");
  }
}
