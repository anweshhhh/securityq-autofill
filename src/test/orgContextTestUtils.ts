import { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RequestContext } from "@/lib/requestContext";

export type SeededUserOrgs = {
  userId: string;
  orgAId: string;
  orgBId: string;
};

export async function seedUserWithTwoOrganizations(params: {
  emailPrefix: string;
  orgPrefix: string;
}): Promise<SeededUserOrgs> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const user = await prisma.user.create({
    data: {
      email: `${params.emailPrefix}${suffix}@example.com`
    }
  });

  const orgA = await prisma.organization.create({
    data: {
      name: `${params.orgPrefix}${suffix}-a`
    }
  });
  const orgB = await prisma.organization.create({
    data: {
      name: `${params.orgPrefix}${suffix}-b`
    }
  });

  return {
    userId: user.id,
    orgAId: orgA.id,
    orgBId: orgB.id
  };
}

export async function setActiveOrgForUser(params: {
  userId: string;
  orgId: string;
  role: MembershipRole;
}): Promise<RequestContext> {
  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: params.userId,
        organizationId: params.orgId
      }
    },
    create: {
      userId: params.userId,
      organizationId: params.orgId,
      role: params.role
    },
    update: {
      role: params.role
    }
  });

  await prisma.user.update({
    where: {
      id: params.userId
    },
    data: {
      lastUsedOrganizationId: params.orgId
    }
  });

  return {
    userId: params.userId,
    orgId: params.orgId,
    role: params.role
  };
}
