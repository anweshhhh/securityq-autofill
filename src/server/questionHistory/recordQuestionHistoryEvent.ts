import type { Prisma, QuestionHistoryEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type HistoryDb = Prisma.TransactionClient | typeof prisma;

export async function recordQuestionHistoryEvent(params: {
  db: HistoryDb;
  organizationId: string;
  questionnaireId: string;
  questionId: string;
  type: QuestionHistoryEventType;
  approvedAnswerId?: string | null;
}) {
  await params.db.questionHistoryEvent.create({
    data: {
      organizationId: params.organizationId,
      questionnaireId: params.questionnaireId,
      questionId: params.questionId,
      type: params.type,
      approvedAnswerId: params.approvedAnswerId ?? null
    }
  });
}
