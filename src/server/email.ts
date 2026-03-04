import { createTransport } from "nodemailer";
import { InviteRole } from "@prisma/client";

export type EmailErrorCode = "EMAIL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED";

export class EmailDeliveryError extends Error {
  readonly code: EmailErrorCode;
  readonly status: number;

  constructor(params: { code: EmailErrorCode; message: string; cause?: unknown }) {
    super(params.message);
    this.name = "EmailDeliveryError";
    this.code = params.code;
    this.status = 500;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function getSmtpConfig(): { server: string; from: string } {
  const server = process.env.EMAIL_SERVER?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";

  if (!server || !from) {
    throw new EmailDeliveryError({
      code: "EMAIL_NOT_CONFIGURED",
      message: "EMAIL_SERVER and EMAIL_FROM must be configured in production."
    });
  }

  return { server, from };
}

async function sendEmailMessage(message: EmailMessage): Promise<void> {
  const smtp = getSmtpConfig();

  try {
    const transport = createTransport(smtp.server);
    await transport.sendMail({
      to: message.to,
      from: smtp.from,
      subject: message.subject,
      text: message.text,
      html: message.html
    });
  } catch (error) {
    throw new EmailDeliveryError({
      code: "EMAIL_SEND_FAILED",
      message: "Failed to send email.",
      cause: error
    });
  }
}

function hostForUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "SecurityQ";
  }
}

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  if (!isProduction()) {
    console.log(`MAGIC LINK (dev): ${url}`);
    return;
  }

  const host = hostForUrl(url);
  await sendEmailMessage({
    to,
    subject: `Sign in to ${host}`,
    text: `Sign in to ${host}\n${url}\n`,
    html: `<p>Sign in to <strong>${host}</strong>:</p><p><a href="${url}">${url}</a></p>`
  });
}

export async function sendInviteEmail(
  to: string,
  url: string,
  organizationName: string,
  role: InviteRole
): Promise<void> {
  if (!isProduction()) {
    console.log(`INVITE LINK (dev): ${url}`);
    return;
  }

  const normalizedRole = role.toLowerCase();
  await sendEmailMessage({
    to,
    subject: `SecurityQ invite: ${organizationName}`,
    text: `You were invited to join ${organizationName} as ${normalizedRole}.\n\nAccept invite: ${url}\n`,
    html: `<p>You were invited to join <strong>${organizationName}</strong> as <strong>${normalizedRole}</strong>.</p><p><a href="${url}">Accept invite</a></p>`
  });
}
