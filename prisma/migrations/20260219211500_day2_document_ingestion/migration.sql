-- Create new enum values for ingestion statuses
CREATE TYPE "DocumentStatus_new" AS ENUM ('UPLOADED', 'CHUNKED', 'ERROR');

-- Update existing status values into the new enum
ALTER TABLE "Document" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Document"
ALTER COLUMN "status" TYPE "DocumentStatus_new"
USING (
  CASE
    WHEN "status"::text = 'DRAFT' THEN 'UPLOADED'
    WHEN "status"::text = 'INGESTED' THEN 'CHUNKED'
    WHEN "status"::text = 'ARCHIVED' THEN 'ERROR'
    ELSE 'UPLOADED'
  END
)::"DocumentStatus_new";

ALTER TYPE "DocumentStatus" RENAME TO "DocumentStatus_old";
ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";
DROP TYPE "DocumentStatus_old";

-- Add ingestion metadata fields on documents
ALTER TABLE "Document" RENAME COLUMN "title" TO "name";
ALTER TABLE "Document" ADD COLUMN "originalName" TEXT;
UPDATE "Document" SET "originalName" = "name" WHERE "originalName" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "originalName" SET NOT NULL;

ALTER TABLE "Document" ADD COLUMN "mimeType" TEXT;
UPDATE "Document" SET "mimeType" = 'text/plain' WHERE "mimeType" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "mimeType" SET NOT NULL;

ALTER TABLE "Document" ALTER COLUMN "status" SET DEFAULT 'UPLOADED';

-- Add stable chunk index for deterministic evidence references
ALTER TABLE "DocumentChunk" ADD COLUMN "chunkIndex" INTEGER;

WITH ranked_chunks AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "documentId" ORDER BY "createdAt", "id") - 1 AS idx
  FROM "DocumentChunk"
)
UPDATE "DocumentChunk" AS dc
SET "chunkIndex" = ranked_chunks.idx
FROM ranked_chunks
WHERE dc."id" = ranked_chunks."id";

ALTER TABLE "DocumentChunk" ALTER COLUMN "chunkIndex" SET NOT NULL;
CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key" ON "DocumentChunk"("documentId", "chunkIndex");
