import { prisma } from "@/lib/prisma";

type EnsureUserOrganizationParams = {
  userId: string;
  email?: string | null;
  name?: string | null;
};

function buildOrganizationName(params: { email?: string | null; name?: string | null; userId: string }): string {
  const normalizedName = (params.name ?? "").trim();
  if (normalizedName.length > 0) {
    return `${normalizedName} Workspace`;
  }

  const emailLocalPart = (params.email ?? "").split("@")[0]?.trim();
  if (emailLocalPart && emailLocalPart.length > 0) {
    return `${emailLocalPart} Workspace`;
  }

  return `Workspace ${params.userId.slice(0, 8)}`;
}

export async function ensureUserOrganization(params: EnsureUserOrganizationParams) {
  const userId = params.userId.trim();
  if (!userId) {
    throw new Error("Authenticated user ID is required.");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        organizationId: true
      }
    });

    if (!user) {
      throw new Error("Authenticated user not found.");
    }

    if (user.organizationId) {
      const existingOrganization = await tx.organization.findUnique({
        where: { id: user.organizationId }
      });
      if (existingOrganization) {
        return existingOrganization;
      }
    }

    const organization = await tx.organization.create({
      data: {
        name: buildOrganizationName({
          name: user.name ?? params.name ?? null,
          email: user.email ?? params.email ?? null,
          userId: user.id
        })
      }
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        organizationId: organization.id
      }
    });

    return organization;
  });
}
