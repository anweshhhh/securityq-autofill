import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { listUserMemberships } from "@/lib/organizationMembership";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const [session, ctx] = await Promise.all([auth(), getRequestContext(request)]);
    const [organization, memberships] = await Promise.all([
      prisma.organization.findUnique({
        where: {
          id: ctx.orgId
        },
        select: {
          id: true,
          name: true
        }
      }),
      listUserMemberships(ctx.userId)
    ]);

    if (!organization) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Active organization not found."
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      user: {
        id: ctx.userId,
        email: session?.user?.email ?? null
      },
      org: {
        id: organization.id,
        name: organization.name
      },
      role: ctx.role,
      memberships
    });
  } catch (error) {
    console.error("Failed to load /api/me", error);
    return toApiErrorResponse(error, "Failed to load user context.");
  }
}
