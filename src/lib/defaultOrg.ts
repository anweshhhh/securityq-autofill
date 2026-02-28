import { auth } from "@/auth";
import { getRequestContext } from "@/lib/requestContext";
import { prisma } from "@/lib/prisma";

export async function getOrCreateDefaultOrganization() {
  // Deprecated compatibility helper. All production routes should use getRequestContext directly.
  await auth();
  const context = await getRequestContext();
  return prisma.organization.findUniqueOrThrow({
    where: {
      id: context.orgId
    }
  });
}
