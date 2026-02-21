import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.restoreAllMocks();
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
        displayName: string;
        updatedAt: string;
        errorMessage: string | null;
        chunkCount: number;
      }>;
    };

    const listedDocument = listPayload.documents.find(
      (listedItem) => listedItem.id === uploadPayload.document?.id
    );

    expect(listResponse.status).toBe(200);
    expect(listedDocument).toBeDefined();
    expect(listedDocument?.displayName).toBeTruthy();
    expect(listedDocument?.updatedAt).toBeTruthy();
    expect(listedDocument?.errorMessage).toBeNull();
    expect(listedDocument?.chunkCount).toBe(uploadPayload.document?.chunkCount);
  });

  it("uploads md without relying on mime type and stores chunks", async () => {
    const fileName = `${TEST_FILE_PREFIX}${Date.now()}.md`;
    const text = "# Access Controls\n\nWe enforce SAML SSO and MFA.";

    const formData = new FormData();
    formData.append("file", new File([text], fileName));

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
  });

  it("marks document as ERROR when chunk persistence fails", async () => {
    const fileName = `${TEST_FILE_PREFIX}${Date.now()}.md`;
    const text = "# Failure Path\n\nThis should fail while storing chunks.";

    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("simulated failure"));

    const formData = new FormData();
    formData.append("file", new File([text], fileName, { type: "text/markdown" }));

    const uploadRequest = new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body: formData
    });

    const uploadResponse = await POST(uploadRequest);
    expect(uploadResponse.status).toBe(500);

    const failedDocument = await prisma.document.findFirst({
      where: { originalName: fileName }
    });

    expect(failedDocument).not.toBeNull();
    expect(failedDocument?.status).toBe("ERROR");
    expect(failedDocument?.errorMessage).toContain("simulated failure");
  });
});
