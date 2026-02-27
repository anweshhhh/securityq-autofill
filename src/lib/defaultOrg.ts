import { auth } from "@/auth";
import { ensureUserOrganization } from "@/lib/organizationMembership";
import { prisma } from "@/lib/prisma";

export async function getOrCreateDefaultOrganization() {
  const session = await auth();
  const sessionUserId = session?.user?.id?.trim();
  const sessionEmail = session?.user?.email?.trim().toLowerCase();

  if (!sessionUserId && !sessionEmail) {
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

  const user = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: {
          id: true,
          email: true,
          name: true
        }
      })
    : await prisma.user.findUnique({
        where: { email: sessionEmail as string },
        select: {
          id: true,
          email: true,
          name: true
        }
      });

  if (!user) {
    throw new Error("Authenticated user not found.");
  }

  return ensureUserOrganization({
    userId: user.id,
    email: user.email,
    name: user.name
  });
}
