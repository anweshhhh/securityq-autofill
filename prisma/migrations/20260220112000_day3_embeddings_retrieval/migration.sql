CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "DocumentChunk"
ALTER COLUMN "embedding" TYPE vector(1536)
USING (
  CASE
    WHEN "embedding" IS NULL THEN NULL
    ELSE "embedding"::vector(1536)
  END
);

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_cosine_idx"
ON "DocumentChunk"
USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);
