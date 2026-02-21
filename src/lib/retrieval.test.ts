import { describe, expect, it, vi } from "vitest";
import { RETRIEVAL_SQL, retrieveTopChunks } from "./retrieval";

describe("retrieveTopChunks", () => {
  it("builds pgvector query and returns deterministic ordering", async () => {
    const mockDb = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk-b",
          docName: "Doc B",
          content:
            "Encryption policy scope statement. ".repeat(20) +
            "TLS 1.2 is required for all external connections and customer traffic. " +
            "Additional monitoring controls are documented.",
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
    expect(result[1].quotedSnippet.endsWith("requir")).toBe(false);
    expect(/[.!?]$/.test(result[1].quotedSnippet)).toBe(true);
  });

  it("extracts section-based snippet for backup and includes RTO/RPO lines", async () => {
    const mockDb = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk-backup",
          docName: "Backup and DR",
          content: [
            "## Company Overview",
            "General information about controls.",
            "",
            "## Backup & Disaster Recovery",
            "Backups are performed daily.",
            "Disaster recovery testing is performed annually.",
            "Recovery objectives:",
            "Target RPO: 24 hours",
            "Target RTO: 24 hours",
            "Retention is 30 days."
          ].join("\n"),
          distance: 0.08
        }
      ])
    };

    const result = await retrieveTopChunks({
      organizationId: "org-1",
      questionEmbedding: [0.1, 0.2, 0.3],
      questionText: "Provide backup frequency, DR testing cadence, and RTO/RPO.",
      topK: 1,
      db: mockDb
    });

    expect(result).toHaveLength(1);
    expect(result[0].quotedSnippet).toContain("## Backup & Disaster Recovery");
    expect(result[0].quotedSnippet).toContain("Target RPO: 24 hours");
    expect(result[0].quotedSnippet).toContain("Target RTO: 24 hours");
  });

  it("normalizes malformed retention ranges in snippets", async () => {
    const mockDb = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk-logs",
          docName: "Logging Policy",
          content: "Logs are retained for 30�90 days to support monitoring and investigations.",
          distance: 0.06
        }
      ])
    };

    const result = await retrieveTopChunks({
      organizationId: "org-1",
      questionEmbedding: [0.1, 0.2, 0.3],
      questionText: "What is your log retention period?",
      topK: 1,
      db: mockDb
    });

    expect(result).toHaveLength(1);
    expect(result[0].quotedSnippet).toContain("30-90 days");
    expect(result[0].fullContent).toContain("30-90 days");
  });
});
