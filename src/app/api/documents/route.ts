import { NextResponse } from "next/server";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    assertCan(ctx.role, RbacAction.VIEW_DOCUMENTS);

    const documents = await prisma.document.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: { chunks: true }
        }
      }
    });

    return NextResponse.json({
      documents: documents.map((document) => ({
        id: document.id,
        name: document.name,
        displayName: document.name || document.originalName,
        originalName: document.originalName,
        mimeType: document.mimeType,
        status: document.status,
        errorMessage: document.errorMessage,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        chunkCount: document._count.chunks
      }))
    });
  } catch (error) {
    console.error("Failed to list documents", error);
    return toApiErrorResponse(error, "Failed to list documents.");
  }
}
