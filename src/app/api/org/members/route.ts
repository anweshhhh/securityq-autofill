import { NextResponse } from "next/server";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.VIEW_MEMBERS);

    const memberships = await prisma.membership.findMany({
      where: {
        organizationId: ctx.orgId
      },
      orderBy: [{ createdAt: "asc" }],
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });

    return NextResponse.json({
      members: memberships.map((membership) => ({
        userId: membership.userId,
        email: membership.user.email ?? "",
        role: membership.role,
        joinedAt: membership.createdAt
      }))
    });
  } catch (error) {
    console.error("Failed to list organization members", error);
    return toApiErrorResponse(error, "Failed to list organization members.");
  }
}
