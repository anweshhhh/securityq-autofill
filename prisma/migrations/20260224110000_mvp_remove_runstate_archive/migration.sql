ALTER TABLE "Questionnaire"
DROP COLUMN IF EXISTS "archivedAt",
DROP COLUMN IF EXISTS "runStatus",
DROP COLUMN IF EXISTS "processedCount",
DROP COLUMN IF EXISTS "foundCount",
DROP COLUMN IF EXISTS "notFoundCount",
DROP COLUMN IF EXISTS "lastError",
DROP COLUMN IF EXISTS "startedAt",
DROP COLUMN IF EXISTS "finishedAt";

ALTER TABLE "Question"
DROP COLUMN IF EXISTS "lastRerunAt";

DROP TYPE IF EXISTS "QuestionnaireRunStatus";
