ALTER TABLE "Questionnaire"
ADD COLUMN "sourceFileName" TEXT,
ADD COLUMN "questionColumn" TEXT,
ADD COLUMN "sourceHeaders" JSONB;

ALTER TABLE "Question"
ADD COLUMN "rowIndex" INTEGER,
ADD COLUMN "sourceRow" JSONB,
ADD COLUMN "answer" TEXT,
ADD COLUMN "citations" JSONB,
ADD COLUMN "confidence" TEXT,
ADD COLUMN "needsReview" BOOLEAN;

WITH ranked_questions AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "questionnaireId" ORDER BY "createdAt", "id") - 1 AS idx
  FROM "Question"
)
UPDATE "Question" AS q
SET "rowIndex" = ranked_questions.idx
FROM ranked_questions
WHERE q."id" = ranked_questions."id";

UPDATE "Question"
SET "sourceRow" = '{}'::jsonb,
    "citations" = '[]'::jsonb
WHERE "sourceRow" IS NULL OR "citations" IS NULL;

ALTER TABLE "Question"
ALTER COLUMN "rowIndex" SET NOT NULL,
ALTER COLUMN "sourceRow" SET NOT NULL,
ALTER COLUMN "citations" SET NOT NULL;

CREATE UNIQUE INDEX "Question_questionnaireId_rowIndex_key"
ON "Question"("questionnaireId", "rowIndex");
