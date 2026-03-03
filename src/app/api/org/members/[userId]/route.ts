import { MembershipRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

type UpdateRoleBody = {
  role?: unknown;
};

const VALID_MEMBER_ROLES = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.REVIEWER,
  MembershipRole.VIEWER
]);

function parseMembershipRole(value: unknown): MembershipRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!VALID_MEMBER_ROLES.has(normalized as MembershipRole)) {
    return null;
  }

  return normalized as MembershipRole;
}

type RouteContext = {
  params: {
    userId: string;
  };
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const targetUserId = context.params.userId.trim();
    if (!targetUserId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "userId is required."
      });
    }

    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.UPDATE_MEMBER_ROLE);

    const payload = (await request.json().catch(() => null)) as UpdateRoleBody | null;
    const nextRole = parseMembershipRole(payload?.role);
    if (!nextRole) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "role must be one of OWNER, ADMIN, REVIEWER, VIEWER."
      });
    }

    const existingMembership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId: ctx.orgId
        }
      },
      select: {
        id: true,
        role: true
      }
    });

    if (!existingMembership) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Member not found."
      });
    }

    if (existingMembership.role === MembershipRole.OWNER && nextRole !== MembershipRole.OWNER) {
      const ownerCount = await prisma.membership.count({
        where: {
          organizationId: ctx.orgId,
          role: MembershipRole.OWNER
        }
      });

      if (ownerCount <= 1) {
        return jsonError({
          status: 409,
          code: "CONFLICT",
          message: "Cannot demote the last OWNER in the organization."
        });
      }
    }

    const updated = await prisma.membership.update({
      where: {
        id: existingMembership.id
      },
      data: {
        role: nextRole
      },
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    });

    return NextResponse.json({
      member: {
        userId: updated.userId,
        email: updated.user.email ?? "",
        role: updated.role,
        joinedAt: updated.createdAt
      }
    });
  } catch (error) {
    console.error("Failed to update member role", error);
    return toApiErrorResponse(error, "Failed to update member role.");
  }
}
