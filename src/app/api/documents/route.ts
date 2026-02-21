import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const organization = await getOrCreateDefaultOrganization();

    const documents = await prisma.document.findMany({
      where: { organizationId: organization.id },
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
        status: document.status,
        errorMessage: document.errorMessage,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        chunkCount: document._count.chunks
      }))
    });
  } catch (error) {
    console.error("Failed to list documents", error);
    return NextResponse.json({ error: "Failed to list documents" }, { status: 500 });
  }
}
