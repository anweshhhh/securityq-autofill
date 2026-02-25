import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const documentId = context.params.id;

    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId: organization.id
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
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
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
    return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const organization = await getOrCreateDefaultOrganization();
    const documentId = context.params.id;

    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId: organization.id
      },
      select: {
        id: true
      }
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
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
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}
