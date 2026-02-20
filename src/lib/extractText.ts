const SUPPORTED_MIME_TYPES = new Set(["text/plain", "text/markdown"]);
const SUPPORTED_EXTENSIONS = [".txt", ".md"];

export function isSupportedTextFile(file: Pick<File, "name" | "type">): boolean {
  if (file.type && SUPPORTED_MIME_TYPES.has(file.type)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export function inferMimeType(file: Pick<File, "name" | "type">): string {
  if (file.type) {
    return file.type;
  }

  return file.name.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain";
}

export async function extractText(file: File): Promise<string> {
  return file.text();
}
