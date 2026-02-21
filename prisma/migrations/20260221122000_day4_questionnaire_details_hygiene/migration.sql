-- AlterTable
ALTER TABLE "Questionnaire" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Question" ADD COLUMN "lastRerunAt" TIMESTAMP(3);
