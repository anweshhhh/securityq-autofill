import { createHash } from "node:crypto";
import { sanitizeExtractedText } from "@/lib/textNormalization";

function toBigrams(value: string): Set<string> {
  if (value.length < 2) {
    return new Set(value ? [value] : []);
  }

  const bag = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    bag.add(value.slice(index, index + 2));
  }

  return bag;
}

export function normalizeQuestionText(value: string): string {
  return sanitizeExtractedText(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashNormalizedQuestionText(normalizedQuestionText: string): string {
  return createHash("md5").update(normalizedQuestionText).digest("hex");
}

export function buildQuestionTextMetadata(questionText: string): {
  normalizedQuestionText: string;
  questionTextHash: string;
} {
  const normalizedQuestionText = normalizeQuestionText(questionText);
  return {
    normalizedQuestionText,
    questionTextHash: hashNormalizedQuestionText(normalizedQuestionText)
  };
}

export function questionTextNearExactSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeQuestionText(left);
  const normalizedRight = normalizeQuestionText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftBigrams = toBigrams(normalizedLeft);
  const rightBigrams = toBigrams(normalizedRight);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}
