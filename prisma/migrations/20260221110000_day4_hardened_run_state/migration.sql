CREATE TYPE "QuestionnaireRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

ALTER TABLE "Questionnaire"
ADD COLUMN "runStatus" "QuestionnaireRunStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "foundCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "notFoundCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastError" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "finishedAt" TIMESTAMP(3);

UPDATE "Questionnaire"
SET
  "totalCount" = q.count,
  "processedCount" = q.answered_count,
  "foundCount" = q.found_count,
  "notFoundCount" = q.not_found_count,
  "runStatus" = CASE
    WHEN q.count = 0 THEN 'PENDING'::"QuestionnaireRunStatus"
    WHEN q.answered_count >= q.count THEN 'COMPLETED'::"QuestionnaireRunStatus"
    ELSE 'PENDING'::"QuestionnaireRunStatus"
  END
FROM (
  SELECT
    questionnaire."id" AS questionnaire_id,
    COUNT(question."id")::int AS count,
    COUNT(question."id") FILTER (WHERE question."answer" IS NOT NULL AND LENGTH(TRIM(question."answer")) > 0)::int AS answered_count,
    COUNT(question."id") FILTER (WHERE question."answer" = 'Not found in provided documents.')::int AS not_found_count,
    COUNT(question."id") FILTER (WHERE question."answer" IS NOT NULL AND question."answer" <> 'Not found in provided documents.')::int AS found_count
  FROM "Questionnaire" questionnaire
  LEFT JOIN "Question" question ON question."questionnaireId" = questionnaire."id"
  GROUP BY questionnaire."id"
) q
WHERE "Questionnaire"."id" = q.questionnaire_id;
