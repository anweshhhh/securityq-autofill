import { NextResponse } from "next/server";
import { listUserMemberships } from "@/lib/organizationMembership";
import { prisma } from "@/lib/prisma";
import { getRequestContext, RequestContextError } from "@/lib/requestContext";

export const runtime = "nodejs";

export async function GET() {
  try {
    const requestContext = await getRequestContext();
    const [organization, memberships] = await Promise.all([
      prisma.organization.findUnique({
        where: {
          id: requestContext.orgId
        },
        select: {
          id: true,
          name: true
        }
      }),
      listUserMemberships(requestContext.userId)
    ]);

    if (!organization) {
      return NextResponse.json(
        {
          error: {
            code: "ORG_NOT_FOUND",
            message: "Active organization not found."
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      context: {
        userId: requestContext.userId,
        orgId: requestContext.orgId,
        role: requestContext.role,
        orgName: organization.name,
        memberships
      }
    });
  } catch (error) {
    if (error instanceof RequestContextError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message
          }
        },
        { status: error.status }
      );
    }

    console.error("Failed to load auth context", error);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load auth context."
        }
      },
      { status: 500 }
    );
  }
}
