import { prisma } from "@/lib/prisma";

export type ApiErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR";

export class ApiRouteError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(params: { status: number; code: ApiErrorCode; message: string; details?: unknown }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

export function normalizeCitationChunkIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(normalized));
}

export function extractCitationChunkIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const typedEntry = entry as Record<string, unknown>;
      return typeof typedEntry.chunkId === "string" ? typedEntry.chunkId.trim() : null;
    })
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));

  return Array.from(new Set(ids));
}

export async function assertChunkOwnership(params: {
  organizationId: string;
  chunkIds: string[];
}): Promise<void> {
  const normalizedIds = Array.from(new Set(params.chunkIds.map((chunkId) => chunkId.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    throw new ApiRouteError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "citationChunkIds must be a non-empty array of chunk IDs."
    });
  }

  const ownedChunks = await prisma.documentChunk.findMany({
    where: {
      id: {
        in: normalizedIds
      },
      document: {
        organizationId: params.organizationId
      }
    },
    select: {
      id: true
    }
  });

  const ownedChunkIds = new Set(ownedChunks.map((chunk) => chunk.id));
  const invalidChunkIds = normalizedIds.filter((chunkId) => !ownedChunkIds.has(chunkId));

  if (invalidChunkIds.length > 0) {
    throw new ApiRouteError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "One or more citationChunkIds are invalid for this organization.",
      details: {
        invalidChunkIds
      }
    });
  }
}
