import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const { getRequestContextMock, MockRequestContextError } = vi.hoisted(() => ({
  getRequestContextMock: vi.fn(),
  MockRequestContextError: class MockRequestContextError extends Error {
    code: string;
    status: number;

    constructor(message: string, options: { code: string; status: number }) {
      super(message);
      this.code = options.code;
      this.status = options.status;
    }
  }
}));

vi.mock("@/lib/requestContext", () => ({
  getRequestContext: getRequestContextMock,
  RequestContextError: MockRequestContextError
}));

import { POST as switchRoleRoute } from "./route";

const TEST_EMAIL_PREFIX = "vitest-dev-role-user-";
const TEST_ORG_PREFIX = "vitest-dev-role-org-";

type SeedState = {
  userId: string;
  orgId: string;
};

let seeded: SeedState | null = null;

describe.sequential("POST /api/dev/role", () => {
  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const user = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`
      }
    });
    const org = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${suffix}`
      }
    });

    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: MembershipRole.OWNER
      }
    });

    seeded = {
      userId: user.id,
      orgId: org.id
    };

    getRequestContextMock.mockReset();
    getRequestContextMock.mockResolvedValue({
      userId: user.id,
      orgId: org.id,
      role: MembershipRole.OWNER
    });
  });

  afterEach(async () => {
    if (!seeded) {
      return;
    }

    await prisma.membership.deleteMany({
      where: {
        userId: seeded.userId
      }
    });
    await prisma.user.delete({
      where: {
        id: seeded.userId
      }
    });
    await prisma.organization.delete({
      where: {
        id: seeded.orgId
      }
    });
    seeded = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 403 when DEV_MODE=false", async () => {
    if (!seeded) {
      throw new Error("Missing seeded test state.");
    }

    process.env.DEV_MODE = "false";

    const response = await switchRoleRoute(
      new Request("http://localhost/api/dev/role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ role: "VIEWER" })
      })
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as {
      error?: {
        code?: string;
      };
    };
    expect(payload.error?.code).toBe("FORBIDDEN");

    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: seeded.userId,
          organizationId: seeded.orgId
        }
      },
      select: {
        role: true
      }
    });

    expect(membership?.role).toBe(MembershipRole.OWNER);
  });

  it("updates membership role when DEV_MODE=true", async () => {
    if (!seeded) {
      throw new Error("Missing seeded test state.");
    }

    process.env.DEV_MODE = "true";

    const response = await switchRoleRoute(
      new Request("http://localhost/api/dev/role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ role: "REVIEWER" })
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      role?: MembershipRole;
      orgId?: string;
      userId?: string;
    };

    expect(payload.role).toBe(MembershipRole.REVIEWER);
    expect(payload.orgId).toBe(seeded.orgId);
    expect(payload.userId).toBe(seeded.userId);

    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: seeded.userId,
          organizationId: seeded.orgId
        }
      },
      select: {
        role: true
      }
    });

    expect(membership?.role).toBe(MembershipRole.REVIEWER);
  });
});
