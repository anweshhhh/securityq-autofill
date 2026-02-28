import { MembershipRole, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type EnsureUserOrganizationParams = {
  userId: string;
  email?: string | null;
  name?: string | null;
};

export type ActiveOrgForUser = {
  orgId: string;
  role: MembershipRole;
  orgName: string;
  membershipCount: number;
};

export type UserMembershipSummary = {
  orgId: string;
  orgName: string;
  role: MembershipRole;
};

function sanitizeWorkspaceLabel(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9 _'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOrganizationName(params: { email?: string | null; name?: string | null; userId: string }): string {
  const normalizedName = sanitizeWorkspaceLabel(params.name ?? "");
  if (normalizedName.length > 0) {
    return `${normalizedName} Workspace`;
  }

  const emailLocalPartRaw = (params.email ?? "").split("@")[0] ?? "";
  const emailLocalPart = sanitizeWorkspaceLabel(emailLocalPartRaw);
  if (emailLocalPart.length > 0) {
    return `${emailLocalPart}'s Workspace`;
  }

  return `Workspace ${params.userId.slice(0, 8)}`;
}

async function createBootstrapMembership(
  tx: Prisma.TransactionClient,
  user: { id: string; email: string | null; name: string | null },
  params: EnsureUserOrganizationParams
): Promise<ActiveOrgForUser> {
  const organization = await tx.organization.create({
    data: {
      name: buildOrganizationName({
        name: user.name ?? params.name ?? null,
        email: user.email ?? params.email ?? null,
        userId: user.id
      })
    }
  });

  await tx.membership.create({
    data: {
      userId: user.id,
      organizationId: organization.id,
      role: MembershipRole.OWNER
    }
  });

  await tx.user.update({
    where: { id: user.id },
    data: { lastUsedOrganizationId: organization.id }
  });

  return {
    orgId: organization.id,
    orgName: organization.name,
    role: MembershipRole.OWNER,
    membershipCount: 1
  };
}

async function resolveActiveMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  fallbackParams?: EnsureUserOrganizationParams
): Promise<ActiveOrgForUser> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      lastUsedOrganizationId: true
    }
  });

  if (!user) {
    throw new Error("Authenticated user not found.");
  }

  const memberships = await tx.membership.findMany({
    where: { userId: user.id },
    include: {
      organization: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  if (memberships.length === 0) {
    const createParams = fallbackParams ?? {
      userId: user.id,
      email: user.email,
      name: user.name
    };

    return createBootstrapMembership(tx, user, createParams);
  }

  const activeMembership =
    memberships.find((membership) => membership.organizationId === user.lastUsedOrganizationId) ??
    memberships[memberships.length - 1];

  if (activeMembership.organizationId !== user.lastUsedOrganizationId) {
    await tx.user.update({
      where: { id: user.id },
      data: { lastUsedOrganizationId: activeMembership.organizationId }
    });
  }

  return {
    orgId: activeMembership.organizationId,
    orgName: activeMembership.organization.name,
    role: activeMembership.role,
    membershipCount: memberships.length
  };
}

export async function ensureUserOrganizationMembership(params: EnsureUserOrganizationParams): Promise<ActiveOrgForUser> {
  const userId = params.userId.trim();
  if (!userId) {
    throw new Error("Authenticated user ID is required.");
  }

  return prisma.$transaction((tx) => resolveActiveMembership(tx, userId, params));
}

export async function ensureUserOrganization(params: EnsureUserOrganizationParams) {
  const active = await ensureUserOrganizationMembership(params);
  return prisma.organization.findUniqueOrThrow({
    where: { id: active.orgId }
  });
}

export async function getActiveOrgForUser(userId: string): Promise<ActiveOrgForUser> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Authenticated user ID is required.");
  }

  return prisma.$transaction((tx) => resolveActiveMembership(tx, normalizedUserId));
}

export async function listUserMemberships(userId: string): Promise<UserMembershipSummary[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return [];
  }

  const memberships = await prisma.membership.findMany({
    where: {
      userId: normalizedUserId
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  return memberships.map((membership) => ({
    orgId: membership.organizationId,
    orgName: membership.organization.name,
    role: membership.role
  }));
}
