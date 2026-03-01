import { MembershipRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";

type UpdateRoleBody = {
  role?: unknown;
};

const VALID_ROLES = new Set<MembershipRole>([
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.REVIEWER,
  MembershipRole.VIEWER
]);

function parseRole(value: unknown): MembershipRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!VALID_ROLES.has(normalized as MembershipRole)) {
    return null;
  }

  return normalized as MembershipRole;
}

function isDevRoleSwitcherEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_MODE === "true";
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request);

    if (!isDevRoleSwitcherEnabled()) {
      return jsonError({
        status: 403,
        code: "FORBIDDEN",
        message: "Dev role switcher is disabled."
      });
    }

    const payload = (await request.json().catch(() => null)) as UpdateRoleBody | null;
    const role = parseRole(payload?.role);

    if (!role) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "role must be one of OWNER, ADMIN, REVIEWER, VIEWER."
      });
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: ctx.userId,
          organizationId: ctx.orgId
        }
      },
      select: {
        id: true
      }
    });

    if (!membership) {
      return jsonError({
        status: 403,
        code: "FORBIDDEN",
        message: "Active organization membership is required."
      });
    }

    const updated = await prisma.membership.update({
      where: {
        id: membership.id
      },
      data: {
        role
      },
      select: {
        userId: true,
        organizationId: true,
        role: true
      }
    });

    return NextResponse.json({
      userId: updated.userId,
      orgId: updated.organizationId,
      role: updated.role
    });
  } catch (error) {
    console.error("Failed to switch dev role", error);
    return toApiErrorResponse(error, "Failed to switch dev role.");
  }
}
