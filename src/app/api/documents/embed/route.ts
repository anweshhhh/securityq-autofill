import { NextResponse } from "next/server";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { createEmbedding } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { embeddingToVectorLiteral } from "@/lib/retrieval";

type ChunkRow = {
  id: string;
  content: string;
};

export async function POST() {
  try {
    const organization = await getOrCreateDefaultOrganization();

    const chunks = await prisma.$queryRawUnsafe<ChunkRow[]>(
      `
        SELECT dc."id", dc."content"
        FROM "DocumentChunk" dc
        JOIN "Document" d ON d."id" = dc."documentId"
        WHERE d."organizationId" = $1
          AND dc."embedding" IS NULL
        ORDER BY dc."createdAt" ASC, dc."id" ASC
      `,
      organization.id
    );

    if (chunks.length === 0) {
      return NextResponse.json({ embeddedCount: 0, message: "No chunks pending embedding" });
    }

    let embeddedCount = 0;

    for (const chunk of chunks) {
      const embedding = await createEmbedding(chunk.content);

      await prisma.$executeRawUnsafe(
        `UPDATE "DocumentChunk" SET "embedding" = $1::vector(1536) WHERE "id" = $2`,
        embeddingToVectorLiteral(embedding),
        chunk.id
      );

      embeddedCount += 1;
    }

    return NextResponse.json({ embeddedCount });
  } catch (error) {
    console.error("Failed to embed document chunks", error);
    return NextResponse.json({ error: "Failed to embed document chunks" }, { status: 500 });
  }
}
