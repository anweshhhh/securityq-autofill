import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function getServerAuthSession() {
  return auth();
}

export async function getCurrentUser() {
  const session = await auth();
  const userId = session?.user?.id?.trim();

  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      lastUsedOrganizationId: true
    }
  });
}
