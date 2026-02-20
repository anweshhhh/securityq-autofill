import { prisma } from "@/lib/prisma";

const DEFAULT_ORG_NAME = "Default Organization";

export async function getOrCreateDefaultOrganization() {
  const existingOrg = await prisma.organization.findFirst({
    where: { name: DEFAULT_ORG_NAME },
    orderBy: { createdAt: "asc" }
  });

  if (existingOrg) {
    return existingOrg;
  }

  return prisma.organization.create({
    data: { name: DEFAULT_ORG_NAME }
  });
}
