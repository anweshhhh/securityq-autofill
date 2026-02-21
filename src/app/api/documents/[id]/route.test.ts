import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";
import { DELETE } from "./route";

const TEST_FILE_PREFIX = "vitest-delete-";

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

describe.sequential("/api/documents/[id] delete", () => {
  beforeEach(async () => {
    await cleanupTestDocuments();
    await getOrCreateDefaultOrganization();
  });

  afterEach(async () => {
    await cleanupTestDocuments();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deletes a document and related chunks", async () => {
    const organization = await getOrCreateDefaultOrganization();
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        name: "delete-target",
        originalName: `${TEST_FILE_PREFIX}${Date.now()}.txt`,
        mimeType: "text/plain",
        status: "CHUNKED"
      }
    });

    await prisma.documentChunk.createMany({
      data: [
        {
          documentId: document.id,
          chunkIndex: 0,
          content: "chunk-0"
        },
        {
          documentId: document.id,
          chunkIndex: 1,
          content: "chunk-1"
        }
      ]
    });

    const response = await DELETE(new Request(`http://localhost/api/documents/${document.id}`), {
      params: { id: document.id }
    });
    const payload = (await response.json()) as { ok?: boolean };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);

    const deletedDocument = await prisma.document.findUnique({
      where: { id: document.id }
    });
    const remainingChunks = await prisma.documentChunk.count({
      where: { documentId: document.id }
    });

    expect(deletedDocument).toBeNull();
    expect(remainingChunks).toBe(0);
  });

  it("returns 404 when the document does not exist", async () => {
    const response = await DELETE(new Request("http://localhost/api/documents/missing"), {
      params: { id: "missing-doc-id" }
    });

    expect(response.status).toBe(404);
  });
});
