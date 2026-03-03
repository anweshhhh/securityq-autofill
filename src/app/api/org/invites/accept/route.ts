import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { inviteRoleToMembershipRole } from "@/lib/orgInvites";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";

type AcceptInviteBody = {
  token?: unknown;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as AcceptInviteBody | null;
    const token = typeof payload?.token === "string" ? payload.token.trim() : "";
    if (!token) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "token is required."
      });
    }

    const ctx = await getRequestContext(request);
    const user = await prisma.user.findUnique({
      where: {
        id: ctx.userId
      },
      select: {
        id: true,
        email: true
      }
    });

    if (!user) {
      return jsonError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Authentication required."
      });
    }

    const normalizedUserEmail = (user.email ?? "").trim().toLowerCase();
    if (!normalizedUserEmail) {
      return jsonError({
        status: 403,
        code: "FORBIDDEN",
        message: "An email address is required to accept organization invites."
      });
    }

    const invite = await prisma.organizationInvite.findUnique({
      where: {
        token
      },
      select: {
        id: true,
        token: true,
        organizationId: true,
        email: true,
        role: true,
        expiresAt: true,
        usedAt: true
      }
    });

    if (!invite || invite.usedAt || invite.expiresAt <= new Date()) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Invite is invalid, expired, or already used."
      });
    }

    if (normalizedUserEmail !== invite.email.toLowerCase()) {
      return jsonError({
        status: 403,
        code: "FORBIDDEN",
        message: "This invite was issued for a different email address."
      });
    }

    const inviteRole = inviteRoleToMembershipRole(invite.role);

    const accepted = await prisma.$transaction(async (tx) => {
      const existingMembership = await tx.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: ctx.userId,
            organizationId: invite.organizationId
          }
        },
        select: {
          role: true
        }
      });

      const finalRole = existingMembership?.role ?? inviteRole;
      if (!existingMembership) {
        await tx.membership.create({
          data: {
            userId: ctx.userId,
            organizationId: invite.organizationId,
            role: inviteRole
          }
        });
      }

      const useResult = await tx.organizationInvite.updateMany({
        where: {
          id: invite.id,
          usedAt: null,
          expiresAt: {
            gt: new Date()
          }
        },
        data: {
          usedAt: new Date()
        }
      });

      if (useResult.count !== 1) {
        throw new Error("INVITE_NOT_USABLE");
      }

      await tx.user.update({
        where: {
          id: ctx.userId
        },
        data: {
          lastUsedOrganizationId: invite.organizationId
        }
      });

      return {
        orgId: invite.organizationId,
        role: finalRole
      };
    });

    return NextResponse.json(accepted);
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_NOT_USABLE") {
      return jsonError({
        status: 409,
        code: "CONFLICT",
        message: "Invite is invalid, expired, or already used."
      });
    }

    console.error("Failed to accept organization invite", error);
    return toApiErrorResponse(error, "Failed to accept organization invite.");
  }
}
