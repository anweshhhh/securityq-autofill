import { NextResponse } from "next/server";
import { chunkText } from "@/lib/chunker";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { extractText, inferMimeType, isSupportedTextFile } from "@/lib/extractText";
import { prisma } from "@/lib/prisma";

function toFriendlyName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^/.]+$/, "").trim();
  return withoutExtension || filename || "untitled-document";
}

export async function POST(request: Request) {
  let createdDocumentId: string | null = null;

  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (!isSupportedTextFile(fileEntry)) {
      return NextResponse.json(
        { error: "Only .txt and .md files are supported" },
        { status: 400 }
      );
    }

    const organization = await getOrCreateDefaultOrganization();
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        name: toFriendlyName(fileEntry.name),
        originalName: fileEntry.name,
        mimeType: inferMimeType(fileEntry),
        status: "UPLOADED"
      }
    });
    createdDocumentId = document.id;

    const text = await extractText(fileEntry);

    if (!text.trim()) {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "ERROR" }
      });

      return NextResponse.json(
        { error: "Uploaded file is empty", documentId: document.id },
        { status: 422 }
      );
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "ERROR" }
      });

      return NextResponse.json(
        { error: "No chunks generated", documentId: document.id },
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
        data: { status: "CHUNKED" }
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
    if (createdDocumentId) {
      await prisma.document
        .update({
          where: { id: createdDocumentId },
          data: { status: "ERROR" }
        })
        .catch(() => {
          // Keep original request error as source of truth for response path.
        });
    }

    return NextResponse.json({ error: "Failed to upload document" }, { status: 500 });
  }
}
