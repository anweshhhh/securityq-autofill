import { randomBytes } from "node:crypto";
import { InviteRole, MembershipRole } from "@prisma/client";

const DEFAULT_APP_URL = "http://localhost:3000";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const INVITE_EXPIRY_DAYS = 7;

const INVITABLE_ROLES = new Set<InviteRole>([InviteRole.ADMIN, InviteRole.REVIEWER, InviteRole.VIEWER]);

export function parseInviteRole(value: unknown): InviteRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!INVITABLE_ROLES.has(normalized as InviteRole)) {
    return null;
  }

  return normalized as InviteRole;
}

export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function createInviteToken(): string {
  return randomBytes(32).toString("hex");
}

export function getInviteExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

function getAppUrl(): string {
  const configuredUrl =
    process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || process.env.AUTH_URL?.trim() || "";

  if (!configuredUrl) {
    return DEFAULT_APP_URL;
  }

  return configuredUrl.replace(/\/+$/, "");
}

export function buildInviteUrl(token: string): string {
  return `${getAppUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
}

export function inviteRoleToMembershipRole(role: InviteRole): MembershipRole {
  return role as MembershipRole;
}
