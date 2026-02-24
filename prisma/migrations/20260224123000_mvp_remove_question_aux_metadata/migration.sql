-- Drop auxiliary questionnaire answer metadata no longer persisted on Question.
ALTER TABLE "Question"
DROP COLUMN "confidence",
DROP COLUMN "needsReview",
DROP COLUMN "notFoundReason";
