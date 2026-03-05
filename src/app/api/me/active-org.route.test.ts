import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as switchActiveOrgRoute } from "@/app/api/me/active-org/route";
import { getActiveOrgForUser } from "@/lib/organizationMembership";
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

type SeedState = {
  orgAId: string;
  orgBId: string;
  orgCId: string;
  userId: string;
};

type RequestContextShape = {
  userId: string;
  orgId: string;
  role: MembershipRole;
};

let seeded: SeedState | null = null;
let currentContext: RequestContextShape | null = null;

describe.sequential("POST /api/me/active-org", () => {
  beforeEach(async () => {
    getRequestContextMock.mockReset();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const [orgA, orgB, orgC] = await Promise.all([
      prisma.organization.create({
        data: { name: `vitest-active-org-a-${suffix}` }
      }),
      prisma.organization.create({
        data: { name: `vitest-active-org-b-${suffix}` }
      }),
      prisma.organization.create({
        data: { name: `vitest-active-org-c-${suffix}` }
      })
    ]);

    const user = await prisma.user.create({
      data: {
        email: `active-org-${suffix}@example.com`,
        lastUsedOrganizationId: orgA.id
      }
    });

    await prisma.membership.createMany({
      data: [
        {
          userId: user.id,
          organizationId: orgA.id,
          role: MembershipRole.REVIEWER
        },
        {
          userId: user.id,
          organizationId: orgB.id,
          role: MembershipRole.ADMIN
        }
      ]
    });

    seeded = {
      orgAId: orgA.id,
      orgBId: orgB.id,
      orgCId: orgC.id,
      userId: user.id
    };

    currentContext = {
      userId: user.id,
      orgId: orgA.id,
      role: MembershipRole.REVIEWER
    };

    getRequestContextMock.mockImplementation(async () => {
      if (currentContext) {
        return currentContext;
      }

      throw new MockRequestContextError("Authentication required.", {
        code: "UNAUTHORIZED",
        status: 401
      });
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

    await prisma.user.deleteMany({
      where: {
        id: seeded.userId
      }
    });

    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [seeded.orgAId, seeded.orgBId, seeded.orgCId]
        }
      }
    });

    seeded = null;
    currentContext = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("switches to a membership org and persists last used org", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    const response = await switchActiveOrgRoute(
      new Request("http://localhost/api/me/active-org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          organizationId: seeded.orgBId
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const payload = (await response.json()) as {
      ok?: boolean;
      activeOrg?: { id?: string; name?: string };
      role?: MembershipRole;
    };

    expect(payload.ok).toBe(true);
    expect(payload.activeOrg?.id).toBe(seeded.orgBId);
    expect(payload.role).toBe(MembershipRole.ADMIN);

    const userAfter = await prisma.user.findUnique({
      where: { id: seeded.userId },
      select: {
        lastUsedOrganizationId: true
      }
    });
    expect(userAfter?.lastUsedOrganizationId).toBe(seeded.orgBId);

    const active = await getActiveOrgForUser(seeded.userId);
    expect(active.orgId).toBe(seeded.orgBId);
    expect(active.role).toBe(MembershipRole.ADMIN);
  });

  it("returns 403 JSON when switching to a non-membership org", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    const response = await switchActiveOrgRoute(
      new Request("http://localhost/api/me/active-org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          organizationId: seeded.orgCId
        })
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");

    const payload = (await response.json()) as {
      error?: {
        code?: string;
      };
    };
    expect(payload.error?.code).toBe("FORBIDDEN_ORG_SWITCH");
  });
});
