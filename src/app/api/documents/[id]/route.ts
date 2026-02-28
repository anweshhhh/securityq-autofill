import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const ctx = await getRequestContext();
    const documentId = context.params.id.trim();
    if (!documentId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Document ID is required."
      });
    }

    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId: ctx.orgId
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        mimeType: true,
        status: true,
        updatedAt: true,
        chunks: {
          orderBy: { chunkIndex: "asc" },
          select: {
            chunkIndex: true,
            content: true
          }
        }
      }
    });

    if (!document) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Document not found."
      });
    }

    const fullText = document.chunks.map((chunk) => chunk.content).join("\n\n");

    return NextResponse.json({
      document: {
        id: document.id,
        name: document.name,
        originalName: document.originalName,
        mimeType: document.mimeType,
        status: document.status,
        updatedAt: document.updatedAt,
        chunkCount: document.chunks.length,
        fullText
      }
    });
  } catch (error) {
    console.error("Failed to load document", error);
    return toApiErrorResponse(error, "Failed to load document.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const ctx = await getRequestContext();
    const documentId = context.params.id.trim();
    if (!documentId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Document ID is required."
      });
    }

    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId: ctx.orgId
      },
      select: {
        id: true
      }
    });

    if (!document) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Document not found."
      });
    }

    await prisma.$transaction([
      prisma.documentChunk.deleteMany({
        where: { documentId: document.id }
      }),
      prisma.document.delete({
        where: { id: document.id }
      })
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete document", error);
    return toApiErrorResponse(error, "Failed to delete document.");
  }
}
