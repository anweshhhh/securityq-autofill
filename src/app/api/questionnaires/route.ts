import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const organization = await getOrCreateDefaultOrganization();

    const questionnaires = await prisma.questionnaire.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: "desc" },
      include: {
        questions: {
          select: {
            id: true,
            answer: true
          }
        }
      }
    });

    return NextResponse.json({
      questionnaires: questionnaires.map((questionnaire) => ({
        id: questionnaire.id,
        name: questionnaire.name,
        createdAt: questionnaire.createdAt,
        questionCount: questionnaire.questions.length,
        answeredCount: questionnaire.questions.filter(
          (question) => Boolean(question.answer && question.answer.trim())
        ).length
      }))
    });
  } catch (error) {
    console.error("Failed to list questionnaires", error);
    return NextResponse.json({ error: "Failed to list questionnaires" }, { status: 500 });
  }
}
