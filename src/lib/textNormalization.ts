export function sanitizeExtractedText(value: string): string {
  return value
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/(\d)\s*\uFFFD\s*(\d)/g, "$1-$2")
    .replace(/\uFFFD/g, "-")
    .replace(/[‐‑‒–—―−]/g, "-");
}
