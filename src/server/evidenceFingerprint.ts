import { createHash } from "node:crypto";

function normalizeEvidenceText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function computeEvidenceFingerprint(text: string): string {
  const normalized = normalizeEvidenceText(text);
  return createHash("sha256").update(normalized).digest("hex");
}
