import { describe, expect, it, vi } from "vitest";

const {
  getOrCreateDefaultOrganizationMock,
  answerQuestionWithEvidenceMock
} = vi.hoisted(() => ({
  getOrCreateDefaultOrganizationMock: vi.fn(),
  answerQuestionWithEvidenceMock: vi.fn()
}));

vi.mock("@/lib/defaultOrg", () => ({
  getOrCreateDefaultOrganization: getOrCreateDefaultOrganizationMock
}));

vi.mock("@/lib/answering", () => ({
  answerQuestionWithEvidence: answerQuestionWithEvidenceMock
}));

import { POST } from "./route";

describe("/api/questions/answer", () => {
  it("returns answer payload from shared evidence-answering logic", async () => {
    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    answerQuestionWithEvidenceMock.mockResolvedValue({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "Do we support SSO?" })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true
    });

    expect(answerQuestionWithEvidenceMock).toHaveBeenCalledWith({
      organizationId: "org-default",
      question: "Do we support SSO?",
      debug: false
    });
  });

  it("passes debug mode from request body and returns debug payload", async () => {
    getOrCreateDefaultOrganizationMock.mockResolvedValue({ id: "org-default" });
    answerQuestionWithEvidenceMock.mockResolvedValue({
      answer: "Not found in provided documents.",
      citations: [],
      confidence: "low",
      needsReview: true,
      debug: {
        category: "ACCESS_AUTH",
        threshold: 0.35,
        retrievedTopK: [{ chunkId: "chunk-1", docName: "Doc 1", similarity: 0.77, overlap: 2 }],
        afterMustMatch: [{ chunkId: "chunk-1", docName: "Doc 1", similarity: 0.77, overlap: 2 }],
        droppedByMustMatch: [{ chunkId: "chunk-2", docName: "Doc 2", reason: "No must-match terms found" }],
        finalCitations: [{ chunkId: "chunk-1", docName: "Doc 1" }]
      }
    });

    const request = new Request("http://localhost/api/questions/answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: "Do we support SSO?", debug: true })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.debug?.category).toBe("ACCESS_AUTH");
    expect(answerQuestionWithEvidenceMock).toHaveBeenCalledWith({
      organizationId: "org-default",
      question: "Do we support SSO?",
      debug: true
    });
  });
});
