import { InviteRole, MembershipRole } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as acceptInviteRoute } from "@/app/api/org/invites/accept/route";
import { POST as createInviteRoute } from "@/app/api/org/invites/route";
import { GET as membersRoute } from "@/app/api/org/members/route";
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

type RequestContextShape = {
  userId: string;
  orgId: string;
  role: MembershipRole;
};

type SeedState = {
  orgAId: string;
  orgBId: string;
  ownerUserId: string;
  ownerEmail: string;
  inviteeUserId: string;
  inviteeEmail: string;
  viewerUserId: string;
  viewerEmail: string;
  outsiderUserId: string;
  outsiderEmail: string;
};

let seeded: SeedState | null = null;
let currentContext: RequestContextShape | null = null;

async function switchContext(nextContext: RequestContextShape) {
  await prisma.user.update({
    where: {
      id: nextContext.userId
    },
    data: {
      lastUsedOrganizationId: nextContext.orgId
    }
  });

  currentContext = nextContext;
}

describe.sequential("org invites + members management", () => {
  beforeEach(async () => {
    getRequestContextMock.mockReset();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({ data: { name: `vitest-invite-org-a-${suffix}` } }),
      prisma.organization.create({ data: { name: `vitest-invite-org-b-${suffix}` } })
    ]);

    const [owner, invitee, viewer, outsider] = await Promise.all([
      prisma.user.create({ data: { email: `owner-${suffix}@example.com`, lastUsedOrganizationId: orgA.id } }),
      prisma.user.create({ data: { email: `reviewer-${suffix}@example.com`, lastUsedOrganizationId: orgB.id } }),
      prisma.user.create({ data: { email: `viewer-${suffix}@example.com`, lastUsedOrganizationId: orgA.id } }),
      prisma.user.create({ data: { email: `outsider-${suffix}@example.com`, lastUsedOrganizationId: orgB.id } })
    ]);

    await prisma.membership.createMany({
      data: [
        {
          userId: owner.id,
          organizationId: orgA.id,
          role: MembershipRole.OWNER
        },
        {
          userId: invitee.id,
          organizationId: orgB.id,
          role: MembershipRole.OWNER
        },
        {
          userId: viewer.id,
          organizationId: orgA.id,
          role: MembershipRole.VIEWER
        },
        {
          userId: outsider.id,
          organizationId: orgB.id,
          role: MembershipRole.REVIEWER
        }
      ]
    });

    seeded = {
      orgAId: orgA.id,
      orgBId: orgB.id,
      ownerUserId: owner.id,
      ownerEmail: owner.email ?? "",
      inviteeUserId: invitee.id,
      inviteeEmail: invitee.email ?? "",
      viewerUserId: viewer.id,
      viewerEmail: viewer.email ?? "",
      outsiderUserId: outsider.id,
      outsiderEmail: outsider.email ?? ""
    };

    await switchContext({
      userId: owner.id,
      orgId: orgA.id,
      role: MembershipRole.OWNER
    });

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

    await prisma.organizationInvite.deleteMany({
      where: {
        organizationId: {
          in: [seeded.orgAId, seeded.orgBId]
        }
      }
    });

    await prisma.membership.deleteMany({
      where: {
        organizationId: {
          in: [seeded.orgAId, seeded.orgBId]
        }
      }
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: [seeded.ownerUserId, seeded.inviteeUserId, seeded.viewerUserId, seeded.outsiderUserId]
        }
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
    currentContext = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates invite as OWNER and accepts as a different authenticated user", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    const createResponse = await createInviteRoute(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: seeded.inviteeEmail,
          role: "REVIEWER"
        })
      })
    );

    expect(createResponse.status).toBe(200);
    const createPayload = (await createResponse.json()) as {
      inviteId?: string;
      email?: string;
      role?: InviteRole;
      expiresAt?: string;
    };

    expect(createPayload.inviteId).toBeTruthy();
    expect(createPayload.email).toBe(seeded.inviteeEmail.toLowerCase());
    expect(createPayload.role).toBe(InviteRole.REVIEWER);
    expect(createPayload.expiresAt).toBeTruthy();

    const inviteRecord = await prisma.organizationInvite.findUnique({
      where: {
        id: createPayload.inviteId
      }
    });

    expect(inviteRecord?.organizationId).toBe(seeded.orgAId);
    expect(inviteRecord?.usedAt).toBeNull();

    await switchContext({
      userId: seeded.inviteeUserId,
      orgId: seeded.orgBId,
      role: MembershipRole.OWNER
    });

    const acceptResponse = await acceptInviteRoute(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: inviteRecord?.token
        })
      })
    );

    expect(acceptResponse.status).toBe(200);
    const acceptPayload = (await acceptResponse.json()) as {
      orgId?: string;
      role?: MembershipRole;
    };

    expect(acceptPayload.orgId).toBe(seeded.orgAId);
    expect(acceptPayload.role).toBe(MembershipRole.REVIEWER);

    const acceptedMembership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: seeded.inviteeUserId,
          organizationId: seeded.orgAId
        }
      }
    });
    expect(acceptedMembership?.role).toBe(MembershipRole.REVIEWER);

    const consumedInvite = await prisma.organizationInvite.findUnique({
      where: {
        id: createPayload.inviteId
      }
    });
    expect(consumedInvite?.usedAt).not.toBeNull();

    const inviteeUser = await prisma.user.findUnique({
      where: {
        id: seeded.inviteeUserId
      },
      select: {
        lastUsedOrganizationId: true
      }
    });
    expect(inviteeUser?.lastUsedOrganizationId).toBe(seeded.orgAId);
  });

  it("returns JSON EMAIL_NOT_CONFIGURED in production when SMTP is missing", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    const originalNodeEnv = process.env.NODE_ENV;
    const originalEmailServer = process.env.EMAIL_SERVER;
    const originalEmailFrom = process.env.EMAIL_FROM;

    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_SERVER;
    delete process.env.EMAIL_FROM;

    try {
      const createResponse = await createInviteRoute(
        new Request("http://localhost/api/org/invites", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: seeded.inviteeEmail,
            role: "VIEWER"
          })
        })
      );

      expect(createResponse.status).toBe(500);
      expect(createResponse.headers.get("content-type")).toContain("application/json");

      const payload = (await createResponse.json()) as {
        inviteId?: string;
        error?: {
          code?: string;
          message?: string;
        };
      };

      expect(payload.error?.code).toBe("EMAIL_NOT_CONFIGURED");
      expect(payload.inviteId).toBeTruthy();

      const persistedInvite = await prisma.organizationInvite.findUnique({
        where: {
          id: payload.inviteId
        },
        select: {
          id: true,
          organizationId: true,
          usedAt: true
        }
      });

      expect(persistedInvite?.id).toBe(payload.inviteId);
      expect(persistedInvite?.organizationId).toBe(seeded.orgAId);
      expect(persistedInvite?.usedAt).toBeNull();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEmailServer === undefined) {
        delete process.env.EMAIL_SERVER;
      } else {
        process.env.EMAIL_SERVER = originalEmailServer;
      }
      if (originalEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = originalEmailFrom;
      }
    }
  });

  it("rejects reused and expired invite tokens", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    const createdInvite = await prisma.organizationInvite.create({
      data: {
        organizationId: seeded.orgAId,
        email: seeded.inviteeEmail.toLowerCase(),
        role: InviteRole.VIEWER,
        token: `reuse-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdByUserId: seeded.ownerUserId
      }
    });

    await switchContext({
      userId: seeded.inviteeUserId,
      orgId: seeded.orgBId,
      role: MembershipRole.OWNER
    });

    const firstAccept = await acceptInviteRoute(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: createdInvite.token })
      })
    );
    expect(firstAccept.status).toBe(200);

    const secondAccept = await acceptInviteRoute(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: createdInvite.token })
      })
    );
    expect(secondAccept.status).toBeGreaterThanOrEqual(400);

    const expiredInvite = await prisma.organizationInvite.create({
      data: {
        organizationId: seeded.orgAId,
        email: seeded.inviteeEmail.toLowerCase(),
        role: InviteRole.REVIEWER,
        token: `expired-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
        createdByUserId: seeded.ownerUserId
      }
    });

    const expiredAccept = await acceptInviteRoute(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: expiredInvite.token })
      })
    );

    expect(expiredAccept.status).toBe(400);
    const expiredPayload = (await expiredAccept.json()) as {
      error?: {
        message?: string;
      };
    };
    expect(expiredPayload.error?.message).toContain("invalid");
  });

  it("enforces org isolation for members listing and denies invite creation for VIEWER", async () => {
    if (!seeded) {
      throw new Error("Missing seeded state.");
    }

    await switchContext({
      userId: seeded.outsiderUserId,
      orgId: seeded.orgBId,
      role: MembershipRole.REVIEWER
    });

    const orgBMembersResponse = await membersRoute(new Request("http://localhost/api/org/members", { method: "GET" }));
    expect(orgBMembersResponse.status).toBe(200);
    const orgBPayload = (await orgBMembersResponse.json()) as {
      members?: Array<{ email: string }>;
    };
    const listedEmails = new Set((orgBPayload.members ?? []).map((member) => member.email));
    expect(listedEmails.has(seeded.ownerEmail.toLowerCase())).toBe(false);
    expect(listedEmails.has(seeded.outsiderEmail.toLowerCase())).toBe(true);

    await switchContext({
      userId: seeded.viewerUserId,
      orgId: seeded.orgAId,
      role: MembershipRole.VIEWER
    });

    const viewerInviteResponse = await createInviteRoute(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: seeded.outsiderEmail,
          role: "VIEWER"
        })
      })
    );

    expect(viewerInviteResponse.status).toBe(403);
    const viewerInvitePayload = (await viewerInviteResponse.json()) as {
      error?: {
        code?: string;
        requiredRole?: string;
      };
    };
    expect(viewerInvitePayload.error?.code).toBe("FORBIDDEN_ROLE");
    expect(viewerInvitePayload.error?.requiredRole).toBe("ADMIN");
  });
});
