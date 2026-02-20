import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as listDocuments } from "../route";
import { POST } from "./route";

const TEST_FILE_PREFIX = "vitest-upload-";

async function cleanupTestDocuments() {
  const testDocuments = await prisma.document.findMany({
    where: {
      originalName: {
        startsWith: TEST_FILE_PREFIX
      }
    },
    select: { id: true }
  });

  if (testDocuments.length === 0) {
    return;
  }

  const documentIds = testDocuments.map((document) => document.id);

  await prisma.documentChunk.deleteMany({
    where: {
      documentId: {
        in: documentIds
      }
    }
  });

  await prisma.document.deleteMany({
    where: {
      id: {
        in: documentIds
      }
    }
  });
}

describe.sequential("/api/documents/upload", () => {
  beforeEach(async () => {
    await cleanupTestDocuments();
  });

  afterEach(async () => {
    await cleanupTestDocuments();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uploads txt, stores chunks, and appears in documents list", async () => {
    const fileName = `${TEST_FILE_PREFIX}${Date.now()}.txt`;
    const text = "evidence block ".repeat(300);

    const formData = new FormData();
    formData.append("file", new File([text], fileName, { type: "text/plain" }));

    const uploadRequest = new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body: formData
    });

    const uploadResponse = await POST(uploadRequest);
    const uploadPayload = (await uploadResponse.json()) as {
      document?: {
        id: string;
        status: string;
        chunkCount: number;
      };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadPayload.document?.status).toBe("CHUNKED");
    expect(uploadPayload.document?.chunkCount).toBeGreaterThan(0);

    const document = await prisma.document.findUnique({
      where: { id: uploadPayload.document?.id },
      include: {
        chunks: {
          orderBy: { chunkIndex: "asc" }
        }
      }
    });

    expect(document).not.toBeNull();
    expect(document?.status).toBe("CHUNKED");
    expect(document?.chunks.length).toBe(uploadPayload.document?.chunkCount);

    const expectedIndexes = document?.chunks.map((_, index) => index);
    const actualIndexes = document?.chunks.map((chunk) => chunk.chunkIndex);
    expect(actualIndexes).toEqual(expectedIndexes);

    const listResponse = await listDocuments();
    const listPayload = (await listResponse.json()) as {
      documents: Array<{
        id: string;
        chunkCount: number;
      }>;
    };

    const listedDocument = listPayload.documents.find(
      (listedItem) => listedItem.id === uploadPayload.document?.id
    );

    expect(listResponse.status).toBe(200);
    expect(listedDocument).toBeDefined();
    expect(listedDocument?.chunkCount).toBe(uploadPayload.document?.chunkCount);
  });
});
