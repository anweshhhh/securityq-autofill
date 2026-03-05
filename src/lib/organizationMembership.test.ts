import { MembershipRole } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureUserOrganizationMembership, getActiveOrgForUser } from "@/lib/organizationMembership";

const TEST_EMAIL_PREFIX = "vitest-org-membership-";
const TEST_ORG_PREFIX = "vitest-org-membership-org-";

async function cleanupTestRows() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    },
    select: {
      id: true
    }
  });

  const userIds = users.map((user) => user.id);

  if (userIds.length > 0) {
    await prisma.membership.deleteMany({
      where: {
        userId: {
          in: userIds
        }
      }
    });
  }

  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });

  await prisma.organization.deleteMany({
    where: {
      OR: [
        {
          name: {
            startsWith: TEST_ORG_PREFIX
          }
        },
        {
          name: {
            startsWith: TEST_EMAIL_PREFIX
          }
        }
      ]
    }
  });
}

describe("organization membership bootstrap", () => {
  afterEach(async () => {
    await cleanupTestRows();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates one owner membership on first sign-in and remains idempotent on repeat sign-ins", async () => {
    const now = Date.now();
    const email = `${TEST_EMAIL_PREFIX}${now}@example.com`;
    const user = await prisma.user.create({
      data: {
        email
      }
    });

    const first = await ensureUserOrganizationMembership({
      userId: user.id,
      email: user.email,
      name: user.name
    });

    expect(first.role).toBe(MembershipRole.OWNER);
    expect(first.membershipCount).toBe(1);

    const membershipsAfterFirst = await prisma.membership.findMany({
      where: {
        userId: user.id
      }
    });
    expect(membershipsAfterFirst).toHaveLength(1);

    const second = await ensureUserOrganizationMembership({
      userId: user.id,
      email: user.email,
      name: user.name
    });

    expect(second.orgId).toBe(first.orgId);
    expect(second.role).toBe(MembershipRole.OWNER);

    const membershipsAfterSecond = await prisma.membership.findMany({
      where: {
        userId: user.id
      }
    });
    expect(membershipsAfterSecond).toHaveLength(1);

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: {
        id: user.id
      },
      select: {
        lastUsedOrganizationId: true
      }
    });
    expect(userAfter.lastUsedOrganizationId).toBe(first.orgId);
  });

  it("returns the active org and role from the user's membership set", async () => {
    const now = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}${now}-active@example.com`,
        name: "Active Membership Tester"
      }
    });

    const orgA = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${now}-a`
      }
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${now}-b`
      }
    });

    await prisma.membership.createMany({
      data: [
        {
          userId: user.id,
          organizationId: orgA.id,
          role: MembershipRole.ADMIN
        },
        {
          userId: user.id,
          organizationId: orgB.id,
          role: MembershipRole.REVIEWER
        }
      ]
    });

    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        lastUsedOrganizationId: orgB.id
      }
    });

    const active = await getActiveOrgForUser(user.id);
    expect(active.orgId).toBe(orgB.id);
    expect(active.role).toBe(MembershipRole.REVIEWER);
    expect(active.membershipCount).toBe(2);
  });

  it("falls back to first membership when lastUsedOrganizationId is stale", async () => {
    const now = Date.now();
    const staleOrg = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${now}-stale-unused`
      }
    });
    const user = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}${now}-stale@example.com`,
        name: "Stale Active Org Tester",
        lastUsedOrganizationId: staleOrg.id
      }
    });

    const orgA = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${now}-stale-a`
      }
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `${TEST_ORG_PREFIX}${now}-stale-b`
      }
    });

    await prisma.membership.createMany({
      data: [
        {
          userId: user.id,
          organizationId: orgA.id,
          role: MembershipRole.ADMIN
        },
        {
          userId: user.id,
          organizationId: orgB.id,
          role: MembershipRole.REVIEWER
        }
      ]
    });

    const active = await getActiveOrgForUser(user.id);
    expect(active.orgId).toBe(orgA.id);
    expect(active.role).toBe(MembershipRole.ADMIN);

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: {
        id: user.id
      },
      select: {
        lastUsedOrganizationId: true
      }
    });
    expect(userAfter.lastUsedOrganizationId).toBe(orgA.id);
  });
});
