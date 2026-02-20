export const DEFAULT_MAX_CHARS = 1500;
export const DEFAULT_OVERLAP_CHARS = 200;

export type Chunk = {
  chunkIndex: number;
  content: string;
};

export type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
};

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  if (maxChars <= 0) {
    throw new Error("maxChars must be greater than 0");
  }

  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("overlapChars must be >= 0 and less than maxChars");
  }

  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  if (!normalizedText) {
    return [];
  }

  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let start = 0;

  while (start < normalizedText.length) {
    const end = Math.min(start + maxChars, normalizedText.length);

    chunks.push({
      chunkIndex,
      content: normalizedText.slice(start, end)
    });

    chunkIndex += 1;

    if (end >= normalizedText.length) {
      break;
    }

    start = end - overlapChars;
  }

  return chunks;
}
