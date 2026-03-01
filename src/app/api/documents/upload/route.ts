import { NextResponse } from "next/server";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { chunkText } from "@/lib/chunker";
import { extractText, inferMimeType, isSupportedTextFile } from "@/lib/extractText";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

export const runtime = "nodejs";

type ApiErrorShape = {
  error: {
    message: string;
    code: string;
    stack?: string;
  };
};

function isDevMode(): boolean {
  const value = process.env.DEV_MODE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function jsonError(message: string, status: number, code: string, sourceError?: unknown) {
  const payload: ApiErrorShape = {
    error: {
      message,
      code
    }
  };

  if (isDevMode() && sourceError instanceof Error && sourceError.stack) {
    payload.error.stack = sourceError.stack.slice(0, 600);
  }

  return NextResponse.json(payload, { status });
}

function toFriendlyName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^/.]+$/, "").trim();
  return withoutExtension || filename || "untitled-document";
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 280);
  }

  return fallback;
}

async function setDocumentError(documentId: string, reason: string) {
  await prisma.document.update({
    where: { id: documentId },
    data: {
      status: "ERROR",
      errorMessage: reason
    }
  });
}

export async function POST(request: Request) {
  let createdDocumentId: string | null = null;

  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return jsonError("file is required", 400, "UPLOAD_FILE_REQUIRED");
    }

    if (!isSupportedTextFile(fileEntry)) {
      return jsonError("Only .txt, .md, and .pdf files are supported", 400, "UPLOAD_UNSUPPORTED_TYPE");
    }

    const ctx = await getRequestContext();
    assertCan(ctx.role, RbacAction.UPLOAD_DOCUMENTS);
    const document = await prisma.document.create({
      data: {
        organizationId: ctx.orgId,
        name: toFriendlyName(fileEntry.name),
        originalName: fileEntry.name,
        mimeType: inferMimeType(fileEntry),
        status: "UPLOADED",
        errorMessage: null
      }
    });
    createdDocumentId = document.id;

    const text = await extractText(fileEntry);

    if (!text.trim()) {
      await setDocumentError(document.id, "Uploaded file is empty after text extraction");

      return NextResponse.json(
        {
          error: { message: "Uploaded file is empty", code: "UPLOAD_EMPTY_EXTRACTED_TEXT" },
          documentId: document.id
        },
        { status: 422 }
      );
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await setDocumentError(document.id, "No chunks generated from extracted text");

      return NextResponse.json(
        {
          error: { message: "No chunks generated", code: "UPLOAD_NO_CHUNKS" },
          documentId: document.id
        },
        { status: 422 }
      );
    }

    await prisma.$transaction([
      prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: document.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content
        }))
      }),
      prisma.document.update({
        where: { id: document.id },
        data: { status: "CHUNKED", errorMessage: null }
      })
    ]);

    return NextResponse.json(
      {
        document: {
          id: document.id,
          name: document.name,
          originalName: document.originalName,
          status: "CHUNKED",
          chunkCount: chunks.length
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to upload document", error);
    if (createdDocumentId === null) {
      return toApiErrorResponse(error, "Failed to upload document.");
    }

    if (createdDocumentId) {
      const reason = toErrorMessage(error, "Upload processing failed");
      await prisma.document
        .update({ where: { id: createdDocumentId }, data: { status: "ERROR", errorMessage: reason } })
        .catch(() => {
          // Keep original request error as source of truth for response path.
        });
    }

    return jsonError("Failed to upload document", 500, "UPLOAD_INTERNAL_ERROR", error);
  }
}
