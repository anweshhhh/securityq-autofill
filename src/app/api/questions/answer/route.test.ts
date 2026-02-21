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
      question: "Do we support SSO?"
    });
  });
});
