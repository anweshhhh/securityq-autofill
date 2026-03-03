import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import {
  buildInviteUrl,
  createInviteToken,
  deliverOrganizationInvite,
  getInviteExpiryDate,
  normalizeInviteEmail,
  parseInviteRole
} from "@/lib/orgInvites";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

type CreateInviteBody = {
  email?: unknown;
  role?: unknown;
};

export const runtime = "nodejs";

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

    const [organization, inviter] = await Promise.all([
      prisma.organization.findUnique({
        where: {
          id: ctx.orgId
        },
        select: {
          id: true,
          name: true
        }
      }),
      prisma.user.findUnique({
        where: {
          id: ctx.userId
        },
        select: {
          email: true
        }
      })
    ]);

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
    await deliverOrganizationInvite({
      inviteeEmail: invite.email,
      inviteRole: invite.role,
      organizationName: organization.name,
      inviteUrl,
      invitedByEmail: inviter?.email ?? null
    });

    return NextResponse.json({
      inviteId: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt
    });
  } catch (error) {
    console.error("Failed to create organization invite", error);
    return toApiErrorResponse(error, "Failed to create organization invite.");
  }
}
