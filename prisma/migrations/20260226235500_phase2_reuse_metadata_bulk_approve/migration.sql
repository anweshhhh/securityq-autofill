CREATE TYPE "ReuseMatchType" AS ENUM ('EXACT', 'SEMANTIC');

ALTER TABLE "Question"
ADD COLUMN "reusedFromApprovedAnswerId" TEXT,
ADD COLUMN "reuseMatchType" "ReuseMatchType",
ADD COLUMN "reusedAt" TIMESTAMP(3);

CREATE INDEX "Question_questionnaireId_reuseMatchType_idx"
ON "Question"("questionnaireId", "reuseMatchType");
