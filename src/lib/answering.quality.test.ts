import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEmbeddingMock,
  generateGroundedAnswerMock,
  countEmbeddedChunksForOrganizationMock,
  retrieveTopChunksMock
} = vi.hoisted(() => ({
  createEmbeddingMock: vi.fn(),
  generateGroundedAnswerMock: vi.fn(),
  countEmbeddedChunksForOrganizationMock: vi.fn(),
  retrieveTopChunksMock: vi.fn()
}));

vi.mock("./openai", () => ({
  createEmbedding: createEmbeddingMock,
  generateGroundedAnswer: generateGroundedAnswerMock
}));

vi.mock("./retrieval", () => ({
  countEmbeddedChunksForOrganization: countEmbeddedChunksForOrganizationMock,
  retrieveTopChunks: retrieveTopChunksMock
}));

import {
  answerQuestionWithEvidence,
  categorizeQuestion,
  chunkMatchesCategoryMustMatch,
  normalizeForMatch
} from "./answering";

function mockSingleChunk(snippet: string, fullContent?: string, similarity = 0.9) {
  retrieveTopChunksMock.mockResolvedValue([
    {
      chunkId: "chunk-1",
      docName: "Doc 1",
      quotedSnippet: snippet,
      fullContent: fullContent ?? snippet,
      similarity
    }
  ]);
}

function mockBackupOnlyChunks() {
  retrieveTopChunksMock.mockResolvedValue([
    {
      chunkId: "chunk-backup",
      docName: "Backup Policy",
      quotedSnippet: "Backups are performed daily. Disaster recovery tests are conducted annually.",
      fullContent:
        "Backups are performed daily. Disaster recovery tests are conducted annually. " +
        "RPO is 24 hours and RTO is 24 hours.",
      similarity: 0.94
    },
    {
      chunkId: "chunk-overview",
      docName: "Company Overview",
      quotedSnippet: "Our company profile and security mission statement.",
      fullContent: "Our company profile and security mission statement.",
      similarity: 0.92
    }
  ]);
}

describe("answering quality guardrails", () => {
  beforeEach(() => {
    createEmbeddingMock.mockReset();
    generateGroundedAnswerMock.mockReset();
    countEmbeddedChunksForOrganizationMock.mockReset();
    retrieveTopChunksMock.mockReset();

    countEmbeddedChunksForOrganizationMock.mockResolvedValue(1);
    createEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.02));
  });

  it("returns NOT_FOUND when only irrelevant backup chunks exist for pen tests", async () => {
    mockBackupOnlyChunks();

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How often are penetration tests performed?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });

    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("labels NOT_FOUND as RETRIEVAL_BELOW_THRESHOLD when top similarity is low", async () => {
    mockSingleChunk("Production workloads are hosted on AWS.", undefined, 0.2);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Which cloud provider hosts production?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "RETRIEVAL_BELOW_THRESHOLD"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("labels NOT_FOUND as FILTERED_AS_IRRELEVANT when relevance gate drops chunks", async () => {
    retrieveTopChunksMock
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-1",
          docName: "Encryption Policy",
          quotedSnippet: "Encryption is enabled for production data.",
          fullContent: "Encryption is enabled for production data.",
          similarity: 0.91
        }
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-1",
          docName: "Encryption Policy",
          quotedSnippet: "Encryption is enabled for production data.",
          fullContent: "Encryption is enabled for production data.",
          similarity: 0.91
        }
      ]);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "What TLS version, HSTS policy, and cipher suites are enforced for external traffic?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "FILTERED_AS_IRRELEVANT"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("categorizes common security questions deterministically", () => {
    expect(categorizeQuestion("Are backups encrypted and what are RTO/RPO targets?")).toBe("BACKUP_DR");
    expect(categorizeQuestion("Describe your SDLC and CI/CD branch protection controls.")).toBe("SDLC");
    expect(categorizeQuestion("How often do you run penetration tests?")).toBe("PEN_TEST");
    expect(categorizeQuestion("Describe your IR process and severity levels.")).toBe("INCIDENT_RESPONSE");
    expect(categorizeQuestion("Is MFA required for privileged admin access?")).toBe("ACCESS_AUTH");
    expect(categorizeQuestion("Do you enforce RBAC and least privilege?")).toBe("RBAC_LEAST_PRIV");
    expect(categorizeQuestion("Which cloud provider hosts production data and region?")).toBe("HOSTING");
    expect(categorizeQuestion("What is your log retention period?")).toBe("LOG_RETENTION");
    expect(categorizeQuestion("How do you manage API secrets and credential rotation?")).toBe("SECRETS");
    expect(categorizeQuestion("Are subcontractors assessed before onboarding?")).toBe(
      "SUBPROCESSORS_VENDOR"
    );
    expect(categorizeQuestion("Describe tenant data isolation controls.")).toBe("TENANT_ISOLATION");
    expect(categorizeQuestion("Describe physical security controls at your data centers.")).toBe(
      "PHYSICAL_SECURITY"
    );
    expect(categorizeQuestion("Do you provide a security contact email?")).toBe("SECURITY_CONTACT");
  });

  it("normalizes punctuation/casing and matches must-match phrases", () => {
    expect(normalizeForMatch("Backup & Disaster Recovery — Policy")).toBe("backup disaster recovery - policy");
    expect(chunkMatchesCategoryMustMatch("INCIDENT_RESPONSE", "## Incident Response\nSEV-1 to SEV-4")).toBe(
      true
    );
    expect(
      chunkMatchesCategoryMustMatch("BACKUP_DR", "Backup & Disaster Recovery: Daily backups and tested restores")
    ).toBe(true);
  });

  it("returns cited answer for MFA admin-access evidence", async () => {
    mockSingleChunk("MFA is required for privileged/admin accounts.");

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "MFA is required for privileged/admin accounts.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Is MFA required for admin access?"
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.answer.toLowerCase()).toContain("mfa is required for privileged/admin accounts");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("chunk-1");
  });

  it("returns cited answer for least-privilege and RBAC evidence", async () => {
    mockSingleChunk(
      "We follow least privilege and RBAC. Admin access is restricted and reviewed quarterly."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Least privilege and RBAC controls are in place.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Describe your least privilege / RBAC controls for admin access."
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.answer.toLowerCase()).toContain("least privilege");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("chunk-1");
  });

  it("returns partial hosting answer when provider evidence exists but region is missing", async () => {
    mockSingleChunk("Production workloads are hosted on AWS.");

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Production workloads are hosted on AWS.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Which cloud provider hosts production data and in which regions?"
    });

    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("hosted on aws");
    expect(result.answer).toContain("Not specified in provided documents:");
    expect(result.answer.toLowerCase()).toContain("hosting region");
    expect(result.citations).toHaveLength(1);
  });

  it("returns NOT_FOUND for security contact unless email evidence exists", async () => {
    mockSingleChunk("Security contacts are managed by the compliance team.");

    const withoutEmail = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Provide your security contact email."
    });

    expect(withoutEmail).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();

    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-2",
        docName: "Trust Center",
        quotedSnippet: "Security contact: security@attestly.example",
        fullContent: "Security contact: security@attestly.example",
        similarity: 0.91
      }
    ]);
    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Security contact is security@attestly.example.",
      citationChunkIds: ["chunk-2"],
      confidence: "med",
      needsReview: false
    });

    const withEmail = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Provide your security contact email."
    });

    expect(withEmail.answer).not.toBe("Not found in provided documents.");
    expect(withEmail.answer).toContain("security@attestly.example");
    expect(withEmail.citations).toHaveLength(1);
    expect(withEmail.citations[0].chunkId).toBe("chunk-2");
  });

  it("returns NOT_FOUND for secrets question when no secrets evidence exists", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-logging",
        docName: "Logging",
        quotedSnippet: "Centralized logging and monitoring are enabled.",
        fullContent: "Centralized logging and monitoring are enabled.",
        similarity: 0.93
      },
      {
        chunkId: "chunk-backup",
        docName: "Backup",
        quotedSnippet: "Backups are performed daily and tested annually.",
        fullContent: "Backups are performed daily and tested annually.",
        similarity: 0.9
      }
    ]);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How are secrets stored and rotated?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for tenant-isolation questions without tenant evidence", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-access",
        docName: "Access Policy",
        quotedSnippet: "MFA is enabled and access is reviewed quarterly.",
        fullContent: "MFA is enabled and access is reviewed quarterly.",
        similarity: 0.93
      },
      {
        chunkId: "chunk-retention",
        docName: "Retention Policy",
        quotedSnippet: "Data is retained for 30 days after account closure.",
        fullContent: "Data is retained for 30 days after account closure.",
        similarity: 0.89
      }
    ]);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "How is tenant data isolated in your multi-tenant architecture?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for physical security when only generic AWS hosting evidence exists", async () => {
    mockSingleChunk("Production workloads are hosted on AWS.");

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Describe your physical security controls."
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for subcontractor assessments when assessment evidence is missing", async () => {
    mockSingleChunk("Subprocessors include AWS and Stripe.");

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Subprocessors include AWS and Stripe.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Are subcontractors assessed before onboarding and reviewed periodically?"
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
  });

  it("returns cited subprocessors answer when assessment evidence exists", async () => {
    mockSingleChunk(
      "Subprocessors include AWS and Stripe. Subprocessors are reviewed before onboarding and monitored periodically."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Subprocessors are reviewed before onboarding and monitored periodically.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Are subcontractors assessed before onboarding and reviewed periodically?"
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.answer.toLowerCase()).toContain("reviewed before onboarding");
    expect(result.citations).toHaveLength(1);
  });

  it("keeps logging answers focused on logging facts, not backup lines", async () => {
    mockSingleChunk(
      "Security logs are centralized and monitored continuously. Backups are performed daily."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Security logs are centralized and monitored continuously.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Describe logging and monitoring controls."
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.answer.toLowerCase()).toContain("logs are centralized");
    expect(result.answer.toLowerCase()).not.toContain("backups are performed daily");
  });

  it("returns log-retention answer with normalized 30-90 range", async () => {
    mockSingleChunk("Logs are retained for 30�90 days for security monitoring.");

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Logs are retained for 30-90 days.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "What is your log retention period?"
    });

    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.answer).toContain("30-90 days");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].quotedSnippet).toContain("30-90 days");
  });

  it("returns two-part partial answer for backups evidence", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-ir",
        docName: "Incident Response",
        quotedSnippet:
          "Incident response process defines severity levels, triage, mitigation, containment, and recovery.",
        fullContent:
          "Incident response process defines severity levels, triage, mitigation, containment, and recovery.",
        similarity: 0.97
      },
      {
        chunkId: "chunk-backup",
        docName: "Backup and DR",
        quotedSnippet:
          "## Backup & Disaster Recovery\n" +
          "Backups are performed daily.\n" +
          "Disaster recovery testing is performed annually.\n" +
          "Recovery objectives:\n" +
          "Target RPO: 24 hours\n" +
          "Target RTO: 24 hours",
        fullContent:
          "## Backup & Disaster Recovery\n" +
          "Backups are performed daily.\n" +
          "Disaster recovery testing is performed annually.\n" +
          "Recovery objectives:\n" +
          "Target RPO: 24 hours\n" +
          "Target RTO: 24 hours",
        similarity: 0.89
      }
    ]);

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Backups and DR controls are defined.",
      citationChunkIds: ["chunk-backup"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question:
        "Please include backup frequency, DR testing frequency, RTO, RPO, retention period, and restore testing cadence."
    });

    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("backups are performed daily");
    expect(result.answer.toLowerCase()).toContain("disaster recovery testing is performed annually");
    expect(result.answer.toLowerCase()).toContain("target rpo: 24 hours");
    expect(result.answer.toLowerCase()).toContain("target rto: 24 hours");
    expect(result.answer).toContain("Not specified in provided documents:");
    expect(result.answer.toLowerCase()).toContain("retention period");
    expect(result.answer.toLowerCase()).toContain("restore testing cadence");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every((citation) => citation.chunkId !== "chunk-ir")).toBe(true);
    expect(result.citations.some((citation) => citation.chunkId === "chunk-backup")).toBe(true);
    expect(result.needsReview).toBe(true);
  });

  it("returns NOT_FOUND for SDLC when only non-SDLC evidence exists", async () => {
    retrieveTopChunksMock.mockResolvedValue([
      {
        chunkId: "chunk-ir",
        docName: "Incident Response",
        quotedSnippet: "Incident response process defines severity levels and triage workflows.",
        fullContent: "Incident response process defines severity levels and triage workflows.",
        similarity: 0.95
      },
      {
        chunkId: "chunk-access",
        docName: "Access Controls",
        quotedSnippet: "MFA is required for all production systems.",
        fullContent: "MFA is required for all production systems.",
        similarity: 0.91
      }
    ]);

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Describe your SDLC controls including code review and CI/CD pipeline checks."
    });

    expect(result).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      notFoundReason: "NO_RELEVANT_EVIDENCE"
    });
    expect(generateGroundedAnswerMock).not.toHaveBeenCalled();
  });

  it("returns partial SDLC answer when dependency scanning evidence exists", async () => {
    mockSingleChunk(
      "Application security controls include automated dependency scanning on every PR before merge."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "SDLC controls are documented.",
      citationChunkIds: ["chunk-1"],
      confidence: "med",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question:
        "Describe your SDLC and AppSec controls, including code review, branch protection, CI/CD, and change management."
    });

    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("dependency scanning on every pr");
    expect(result.answer).toContain("Not specified in provided documents:");
    expect(result.answer.toLowerCase()).toContain("code review controls");
    expect(result.answer.toLowerCase()).toContain("branch protection controls");
    expect(result.answer.toLowerCase()).toContain("ci/cd pipeline controls");
    expect(result.answer.toLowerCase()).toContain("change management workflow");
    expect(result.answer).not.toBe("Not found in provided documents.");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });

  it("returns two-part IR answer with missing containment/eradication/recovery when absent", async () => {
    mockSingleChunk(
      "The incident response plan defines severity levels and triage workflows. " +
        "Mitigation playbooks are documented for security incidents."
    );

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Incident response controls exist.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question:
        "Describe incident response severity levels, triage, mitigation, containment, eradication, and recovery."
    });

    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("severity levels");
    expect(result.answer.toLowerCase()).toContain("triage");
    expect(result.answer.toLowerCase()).toContain("mitigation");
    expect(result.answer).toContain("Not specified in provided documents:");
    expect(result.answer.toLowerCase()).toContain("containment");
    expect(result.answer.toLowerCase()).toContain("eradication");
    expect(result.answer.toLowerCase()).toContain("recovery");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });

  it("prevents unsupported model claims while preserving evidence citations", async () => {
    mockSingleChunk("Customer data is encrypted at rest.");

    generateGroundedAnswerMock.mockResolvedValue({
      answer: "Customer data is encrypted at rest using AWS KMS.",
      citationChunkIds: ["chunk-1"],
      confidence: "high",
      needsReview: false
    });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "Is customer data encrypted at rest?"
    });

    expect(result.answer.toLowerCase()).not.toContain("aws");
    expect(result.answer.toLowerCase()).not.toContain("kms");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("falls back to deterministic partial answer when model returns fragment output twice", async () => {
    mockSingleChunk(
      "Backup frequency is daily. Disaster recovery tests are conducted annually. RPO is 24 hours and RTO is 24 hours."
    );

    generateGroundedAnswerMock
      .mockResolvedValueOnce({
        answer: "- - Backups daily",
        citationChunkIds: ["chunk-1"],
        confidence: "high",
        needsReview: false
      })
      .mockResolvedValueOnce({
        answer: "- - Recovery annually",
        citationChunkIds: ["chunk-1"],
        confidence: "high",
        needsReview: false
      });

    const result = await answerQuestionWithEvidence({
      organizationId: "org-1",
      question: "What is the backup frequency and RTO/RPO?"
    });

    expect(generateGroundedAnswerMock).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain("Confirmed from provided documents:");
    expect(result.answer.toLowerCase()).toContain("backup frequency is daily");
    expect(result.answer.toLowerCase()).toContain("target rpo: 24 hours");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });
});
