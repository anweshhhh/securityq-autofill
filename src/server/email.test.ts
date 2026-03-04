import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryError, sendInviteEmail, sendMagicLinkEmail } from "@/server/email";

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn()
}));

vi.mock("nodemailer", () => ({
  createTransport: createTransportMock
}));

let originalEnv: NodeJS.ProcessEnv;

describe("server email utility", () => {
  beforeEach(() => {
    originalEnv = { ...process.env };
    createTransportMock.mockReset();
    sendMailMock.mockReset();
    createTransportMock.mockReturnValue({
      sendMail: sendMailMock
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("logs magic and invite links in development", async () => {
    process.env.NODE_ENV = "development";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendMagicLinkEmail("owner@example.com", "http://localhost:3000/api/auth/callback?token=abc");
    await sendInviteEmail(
      "viewer@example.com",
      "http://localhost:3000/accept-invite?token=def",
      "Acme Workspace",
      "VIEWER"
    );

    expect(logSpy).toHaveBeenCalledWith(
      "MAGIC LINK (dev): http://localhost:3000/api/auth/callback?token=abc"
    );
    expect(logSpy).toHaveBeenCalledWith(
      "INVITE LINK (dev): http://localhost:3000/accept-invite?token=def"
    );
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("throws EMAIL_NOT_CONFIGURED in production when SMTP env is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.EMAIL_SERVER;
    delete process.env.EMAIL_FROM;

    await expect(
      sendInviteEmail("reviewer@example.com", "https://app.example.com/accept-invite?token=xyz", "Acme Workspace", "REVIEWER")
    ).rejects.toMatchObject({
      code: "EMAIL_NOT_CONFIGURED",
      status: 500
    } satisfies Partial<EmailDeliveryError>);

    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("throws EMAIL_SEND_FAILED in production when SMTP send fails", async () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_SERVER = "smtp://localhost:1025";
    process.env.EMAIL_FROM = "SecurityQ <noreply@example.com>";
    sendMailMock.mockRejectedValueOnce(new Error("SMTP is down"));

    await expect(
      sendMagicLinkEmail("owner@example.com", "https://app.example.com/api/auth/callback/email?token=t")
    ).rejects.toMatchObject({
      code: "EMAIL_SEND_FAILED",
      status: 500
    } satisfies Partial<EmailDeliveryError>);

    expect(createTransportMock).toHaveBeenCalledWith("smtp://localhost:1025");
  });
});
