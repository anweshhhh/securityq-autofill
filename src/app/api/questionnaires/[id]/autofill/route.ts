import { NextResponse } from "next/server";
import { NOT_FOUND_RESPONSE, answerQuestionWithEvidence } from "@/lib/answering";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: { id: string } }) {
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

    let completedCount = 0;
    let notFoundCount = 0;

    for (const question of questionnaire.questions) {
      const answer = await answerQuestionWithEvidence({
        organizationId: organization.id,
        question: question.text
      });

      if (answer.answer === NOT_FOUND_RESPONSE.answer) {
        notFoundCount += 1;
      }

      await prisma.question.update({
        where: {
          id: question.id
        },
        data: {
          answer: answer.answer,
          citations: answer.citations,
          confidence: answer.confidence,
          needsReview: answer.needsReview
        }
      });

      completedCount += 1;
    }

    return NextResponse.json({
      questionnaireId: questionnaire.id,
      completedCount,
      notFoundCount
    });
  } catch (error) {
    console.error("Failed to autofill questionnaire", error);
    return NextResponse.json({ error: "Failed to autofill questionnaire" }, { status: 500 });
  }
}
