import { auth } from "@/auth";
import { getRequestContext } from "@/lib/requestContext";
import { prisma } from "@/lib/prisma";

export async function getOrCreateDefaultOrganization() {
  const session = await auth();
  const sessionUserId = session?.user?.id?.trim();

  if (!sessionUserId) {
    if (process.env.NODE_ENV === "test") {
      const testOrgName = "Vitest Organization";
      const existingTestOrg = await prisma.organization.findFirst({
        where: { name: testOrgName },
        orderBy: { createdAt: "asc" }
      });

      if (existingTestOrg) {
        return existingTestOrg;
      }

      return prisma.organization.create({
        data: { name: testOrgName }
      });
    }

    throw new Error("Authentication required.");
  }

  const context = await getRequestContext();
  return prisma.organization.findUniqueOrThrow({
    where: {
      id: context.orgId
    }
  });
}
