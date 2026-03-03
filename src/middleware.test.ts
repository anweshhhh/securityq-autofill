import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn()
}));

vi.mock("next-auth/jwt", () => ({
  getToken: getTokenMock
}));

import { middleware } from "../middleware";

describe("auth middleware", () => {
  beforeEach(() => {
    getTokenMock.mockReset();
  });

  it("redirects unauthenticated users from protected pages to /login", async () => {
    getTokenMock.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/documents");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?callbackUrl=%2Fdocuments");
  });

  it("returns JSON 401 for unauthenticated protected API requests", async () => {
    getTokenMock.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/documents");
    const response = await middleware(request);

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required."
      }
    });
  });

  it("allows authenticated requests", async () => {
    getTokenMock.mockResolvedValue({ sub: "user-1" });

    const request = new NextRequest("http://localhost:3000/questionnaires");
    const response = await middleware(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("protects the settings members page", async () => {
    getTokenMock.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/settings/members");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?callbackUrl=%2Fsettings%2Fmembers");
  });
});
