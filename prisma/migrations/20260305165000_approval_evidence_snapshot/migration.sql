CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "DocumentChunk"
ADD COLUMN "evidenceFingerprint" TEXT;

UPDATE "DocumentChunk"
SET "evidenceFingerprint" = encode(
  digest(trim(regexp_replace(coalesce("content", ''), '\\s+', ' ', 'g')), 'sha256'),
  'hex'
);

ALTER TABLE "DocumentChunk"
ALTER COLUMN "evidenceFingerprint" SET NOT NULL;

CREATE TABLE "ApprovedAnswerEvidence" (
  "id" TEXT NOT NULL,
  "approvedAnswerId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "fingerprintAtApproval" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApprovedAnswerEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovedAnswerEvidence_approvedAnswerId_chunkId_key"
ON "ApprovedAnswerEvidence"("approvedAnswerId", "chunkId");

CREATE INDEX "ApprovedAnswerEvidence_approvedAnswerId_idx"
ON "ApprovedAnswerEvidence"("approvedAnswerId");

CREATE INDEX "ApprovedAnswerEvidence_chunkId_idx"
ON "ApprovedAnswerEvidence"("chunkId");

ALTER TABLE "ApprovedAnswerEvidence"
ADD CONSTRAINT "ApprovedAnswerEvidence_approvedAnswerId_fkey"
FOREIGN KEY ("approvedAnswerId") REFERENCES "ApprovedAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApprovedAnswerEvidence"
ADD CONSTRAINT "ApprovedAnswerEvidence_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
