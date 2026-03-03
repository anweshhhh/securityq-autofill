import { randomBytes } from "node:crypto";
import { InviteRole, MembershipRole } from "@prisma/client";
import { createTransport } from "nodemailer";

const isProduction = process.env.NODE_ENV === "production";
const DEFAULT_APP_URL = "http://localhost:3000";
const INVITE_EMAIL_SERVER = process.env.EMAIL_SERVER ?? "";
const INVITE_EMAIL_FROM = process.env.EMAIL_FROM ?? "";

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

export type InviteDeliveryResult = "logged_dev" | "sent_email" | "skipped_email_not_configured";

export async function deliverOrganizationInvite(params: {
  inviteeEmail: string;
  inviteRole: InviteRole;
  organizationName: string;
  inviteUrl: string;
  invitedByEmail?: string | null;
}): Promise<InviteDeliveryResult> {
  if (!isProduction) {
    console.info(`INVITE LINK (dev): ${params.inviteUrl}`);
    return "logged_dev";
  }

  if (!INVITE_EMAIL_SERVER || !INVITE_EMAIL_FROM) {
    console.warn("[org-invites] EMAIL_SERVER/EMAIL_FROM missing; invite email delivery skipped.");
    return "skipped_email_not_configured";
  }

  const transport = createTransport(INVITE_EMAIL_SERVER);
  const invitedByLine = params.invitedByEmail ? `Invited by: ${params.invitedByEmail}\n\n` : "";
  const inviteRoleLabel = params.inviteRole.toLowerCase();

  await transport.sendMail({
    to: params.inviteeEmail,
    from: INVITE_EMAIL_FROM,
    subject: `SecurityQ invite: ${params.organizationName}`,
    text: `You were invited to join ${params.organizationName} as ${inviteRoleLabel}.\n\n${invitedByLine}Accept invite: ${params.inviteUrl}\n`,
    html: `<p>You were invited to join <strong>${params.organizationName}</strong> as <strong>${inviteRoleLabel}</strong>.</p>${
      params.invitedByEmail ? `<p>Invited by: ${params.invitedByEmail}</p>` : ""
    }<p><a href="${params.inviteUrl}">Accept invite</a></p>`
  });

  return "sent_email";
}
