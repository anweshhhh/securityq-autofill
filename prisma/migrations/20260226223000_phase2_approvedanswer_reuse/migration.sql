ALTER TABLE "ApprovedAnswer"
ADD COLUMN "normalizedQuestionText" TEXT NOT NULL DEFAULT '',
ADD COLUMN "questionTextHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN "questionEmbedding" vector(1536);

UPDATE "ApprovedAnswer" aa
SET
  "normalizedQuestionText" = lower(trim(regexp_replace(coalesce(q."text", ''), '\\s+', ' ', 'g'))),
  "questionTextHash" = md5(lower(trim(regexp_replace(coalesce(q."text", ''), '\\s+', ' ', 'g'))))
FROM "Question" q
WHERE aa."questionId" = q."id";

CREATE INDEX "ApprovedAnswer_organizationId_questionTextHash_idx"
ON "ApprovedAnswer"("organizationId", "questionTextHash");

CREATE INDEX "ApprovedAnswer_organizationId_normalizedQuestionText_idx"
ON "ApprovedAnswer"("organizationId", "normalizedQuestionText");
