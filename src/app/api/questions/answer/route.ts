import { NextResponse } from "next/server";
import { answerQuestion } from "@/server/answerEngine";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";

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
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const organization = await getOrCreateDefaultOrganization();
    const answer = await answerQuestion({
      orgId: organization.id,
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
    return NextResponse.json({ error: "Failed to answer question" }, { status: 500 });
  }
}
