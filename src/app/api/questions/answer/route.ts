import { NextResponse } from "next/server";
import { answerQuestionWithEvidence } from "@/lib/answering";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const debugFromQuery = url.searchParams.get("debug") === "true";
    const payload = (await request.json()) as { question?: string; debug?: boolean };
    const question = payload.question?.trim();
    const debug = debugFromQuery || payload.debug === true;

    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const organization = await getOrCreateDefaultOrganization();
    const answer = await answerQuestionWithEvidence({
      organizationId: organization.id,
      question,
      debug
    });

    return NextResponse.json(answer);
  } catch (error) {
    console.error("Failed to answer question", error);
    return NextResponse.json({ error: "Failed to answer question" }, { status: 500 });
  }
}
