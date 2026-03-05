import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveOrgForUser, setActiveOrgForUser } from "@/lib/organizationMembership";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn()
}));

vi.mock("@/auth", () => ({
  auth: authMock
}));

type SeedState = {
  userId: string;
  orgAId: string;
  orgBId: string;
};

let seeded: SeedState | null = null;

describe.sequential("request context active-org resolution", () => {
  beforeEach(async () => {
    authMock.mockReset();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `vitest-request-context-org-a-${suffix}`
        }
      }),
      prisma.organization.create({
        data: {
          name: `vitest-request-context-org-b-${suffix}`
        }
      })
    ]);

    const user = await prisma.user.create({
      data: {
        email: `request-context-${suffix}@example.com`,
        lastUsedOrganizationId: orgA.id
      }
    });

    await prisma.membership.createMany({
      data: [
        {
          userId: user.id,
          organizationId: orgA.id,
          role: MembershipRole.VIEWER
        },
        {
          userId: user.id,
          organizationId: orgB.id,
          role: MembershipRole.ADMIN
        }
      ]
    });

    seeded = {
      userId: user.id,
      orgAId: orgA.id,
      orgBId: orgB.id
    };

    authMock.mockResolvedValue({
      user: {
        id: user.id
      }
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
          in: [seeded.orgAId, seeded.orgBId]
        }
      }
    });

    seeded = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves the newly switched org through getRequestContext", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    const before = await getRequestContext();
    expect(before.orgId).toBe(seeded.orgAId);
    expect(before.role).toBe(MembershipRole.VIEWER);

    const switched = await setActiveOrgForUser(seeded.userId, seeded.orgBId);
    expect(switched?.orgId).toBe(seeded.orgBId);
    expect(switched?.role).toBe(MembershipRole.ADMIN);

    const after = await getRequestContext();
    expect(after.orgId).toBe(seeded.orgBId);
    expect(after.role).toBe(MembershipRole.ADMIN);

    const active = await getActiveOrgForUser(seeded.userId);
    expect(active.orgId).toBe(seeded.orgBId);
  });
});
