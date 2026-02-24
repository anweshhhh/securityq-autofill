-- Phase 1 approval workflow schema: add question review state and expand approved answer payload.

-- 1) New enums
CREATE TYPE "QuestionReviewStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED');
CREATE TYPE "ApprovedAnswerSource" AS ENUM ('GENERATED', 'MANUAL_EDIT');

-- 2) Question review state (default DRAFT)
ALTER TABLE "Question"
ADD COLUMN "reviewStatus" "QuestionReviewStatus" NOT NULL DEFAULT 'DRAFT';

-- 3) Expand ApprovedAnswer while preserving existing data
ALTER TABLE "ApprovedAnswer"
RENAME COLUMN "answer" TO "answerText";

ALTER TABLE "ApprovedAnswer"
ADD COLUMN "citationChunkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "source" "ApprovedAnswerSource" NOT NULL DEFAULT 'GENERATED',
ADD COLUMN "approvedBy" TEXT DEFAULT 'system',
ADD COLUMN "note" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Keep historical continuity for existing rows.
UPDATE "ApprovedAnswer"
SET "updatedAt" = "createdAt"
WHERE "updatedAt" IS NULL;

-- 4) Enforce 1:1 between Question and ApprovedAnswer
CREATE UNIQUE INDEX "ApprovedAnswer_questionId_key" ON "ApprovedAnswer"("questionId");
