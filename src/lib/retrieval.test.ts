import { describe, expect, it, vi } from "vitest";
import { RETRIEVAL_SQL, retrieveTopChunks } from "./retrieval";

describe("retrieveTopChunks", () => {
  it("builds pgvector query and returns deterministic ordering", async () => {
    const mockDb = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk-b",
          docName: "Doc B",
          content: "this snippet includes tls 1.2 and encryption details in context",
          distance: 0.2
        },
        {
          chunkId: "chunk-a",
          docName: "Doc A",
          content: "sso is enabled and mfa is enabled for all user logins",
          distance: 0.2
        },
        {
          chunkId: "chunk-c",
          docName: "Doc C",
          content: "miscellaneous policy notes",
          distance: 0.7
        }
      ])
    };

    const result = await retrieveTopChunks({
      organizationId: "org-1",
      questionEmbedding: [0.1, 0.2, 0.3],
      questionText: "Is TLS 1.2 enabled?",
      topK: 3,
      db: mockDb
    });

    expect(RETRIEVAL_SQL).toContain("ORDER BY distance ASC, dc.\"id\" ASC");
    expect(mockDb.$queryRawUnsafe).toHaveBeenCalledTimes(1);

    const [query, vectorLiteral, organizationId, topK] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(query).toBe(RETRIEVAL_SQL);
    expect(vectorLiteral).toBe("[0.1,0.2,0.3]");
    expect(organizationId).toBe("org-1");
    expect(topK).toBe(3);

    expect(result.map((chunk) => chunk.chunkId)).toEqual(["chunk-a", "chunk-b", "chunk-c"]);
    expect(result[0].similarity).toBeCloseTo(0.8, 5);
    expect(result[2].similarity).toBeCloseTo(0.3, 5);
    expect(result[1].quotedSnippet.toLowerCase()).toContain("tls 1.2");
  });
});
