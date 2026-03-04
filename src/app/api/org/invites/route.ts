import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import {
  buildInviteUrl,
  createInviteToken,
  getInviteExpiryDate,
  normalizeInviteEmail,
  parseInviteRole
} from "@/lib/orgInvites";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";
import { EmailDeliveryError, sendInviteEmail } from "@/server/email";

type CreateInviteBody = {
  email?: unknown;
  role?: unknown;
};

export const runtime = "nodejs";

function isTruthyEnvFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function shouldIncludeInviteUrl(role: string): boolean {
  if (process.env.NODE_ENV !== "production" || isTruthyEnvFlag(process.env.DEV_MODE)) {
    return true;
  }

  return (
    isTruthyEnvFlag(process.env.ALLOW_INVITE_LINK_COPY) &&
    (role === "OWNER" || role === "ADMIN")
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.INVITE_MEMBERS);

    const payload = (await request.json().catch(() => null)) as CreateInviteBody | null;
    const email = normalizeInviteEmail(payload?.email);
    const role = parseInviteRole(payload?.role);

    if (!email) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "email must be a valid email address."
      });
    }

    if (!role) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "role must be one of ADMIN, REVIEWER, VIEWER."
      });
    }

    const organization = await prisma.organization.findUnique({
      where: {
        id: ctx.orgId
      },
      select: {
        id: true,
        name: true
      }
    });

    if (!organization) {
      return jsonError({
        status: 404,
        code: "NOT_FOUND",
        message: "Active organization not found."
      });
    }

    const expiresAt = getInviteExpiryDate();
    const invite = await prisma.organizationInvite.create({
      data: {
        organizationId: organization.id,
        email,
        role,
        token: createInviteToken(),
        expiresAt,
        createdByUserId: ctx.userId
      },
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        expiresAt: true
      }
    });

    const inviteUrl = buildInviteUrl(invite.token);
    const includeInviteUrl = shouldIncludeInviteUrl(ctx.role);

    try {
      await sendInviteEmail(invite.email, inviteUrl, organization.name, invite.role);
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        return NextResponse.json(
          {
            inviteId: invite.id,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt,
            ...(includeInviteUrl ? { inviteUrl } : {}),
            error: {
              code: error.code,
              message: error.message
            }
          },
          { status: error.status }
        );
      }
      throw error;
    }

    return NextResponse.json({
      inviteId: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      ...(includeInviteUrl ? { inviteUrl } : {})
    });
  } catch (error) {
    console.error("Failed to create organization invite", error);
    return toApiErrorResponse(error, "Failed to create organization invite.");
  }
}
