CREATE TYPE "QuestionHistoryEventType" AS ENUM ('DRAFT_UPDATED', 'SUGGESTION_APPLIED', 'APPROVED');

CREATE TABLE "QuestionHistoryEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "questionnaireId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "type" "QuestionHistoryEventType" NOT NULL,
  "approvedAnswerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuestionHistoryEvent_organizationId_questionId_createdAt_idx"
ON "QuestionHistoryEvent"("organizationId", "questionId", "createdAt");

CREATE INDEX "QuestionHistoryEvent_questionnaireId_createdAt_idx"
ON "QuestionHistoryEvent"("questionnaireId", "createdAt");

CREATE INDEX "QuestionHistoryEvent_questionId_createdAt_idx"
ON "QuestionHistoryEvent"("questionId", "createdAt");

ALTER TABLE "QuestionHistoryEvent"
ADD CONSTRAINT "QuestionHistoryEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionHistoryEvent"
ADD CONSTRAINT "QuestionHistoryEvent_questionnaireId_fkey"
FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionHistoryEvent"
ADD CONSTRAINT "QuestionHistoryEvent_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
