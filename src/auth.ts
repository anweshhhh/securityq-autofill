import { PrismaAdapter } from "@auth/prisma-adapter";
import { createTransport } from "nodemailer";
import NextAuth, { type NextAuthOptions, getServerSession } from "next-auth";
import EmailProvider, { type SendVerificationRequestParams } from "next-auth/providers/email";
import { ensureUserOrganizationMembership } from "@/lib/organizationMembership";
import { prisma } from "@/lib/prisma";

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.NEXTAUTH_URL && process.env.AUTH_URL) {
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
}

if (!process.env.NEXTAUTH_SECRET && process.env.AUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = process.env.AUTH_SECRET;
}

const emailServer = process.env.EMAIL_SERVER ?? "";
const emailFrom = process.env.EMAIL_FROM ?? "";
const authSecret =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  (isProduction ? undefined : "dev-insecure-nextauth-secret");

if (!isProduction) {
  const missingConfig: string[] = [];
  if (!process.env.NEXTAUTH_URL && !process.env.AUTH_URL) {
    missingConfig.push("NEXTAUTH_URL (or AUTH_URL)");
  }
  if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) {
    missingConfig.push("NEXTAUTH_SECRET (or AUTH_SECRET)");
  }
  if (!process.env.EMAIL_SERVER) {
    missingConfig.push("EMAIL_SERVER");
  }
  if (!process.env.EMAIL_FROM) {
    missingConfig.push("EMAIL_FROM");
  }

  if (missingConfig.length > 0) {
    console.warn(
      `[auth] Missing auth env in development: ${missingConfig.join(", ")}. Using dev magic-link logging fallback where possible.`
    );
  }
}

async function sendVerificationRequest(params: SendVerificationRequestParams) {
  const { identifier, url, provider } = params;

  try {
    if (!isProduction) {
      console.info("MAGIC LINK (dev) START");
      console.info(url);
      console.info("MAGIC LINK (dev) END");
      return;
    }

    if (!emailServer || !emailFrom) {
      throw new Error("EMAIL_SERVER and EMAIL_FROM must be configured in production.");
    }

    const transport = createTransport(provider.server);
    const { host } = new URL(url);

    await transport.sendMail({
      to: identifier,
      from: provider.from,
      subject: `Sign in to ${host}`,
      text: `Sign in to ${host}\n${url}\n`,
      html: `<p>Sign in to <strong>${host}</strong>:</p><p><a href="${url}">${url}</a></p>`
    });
  } catch (error) {
    if (!isProduction) {
      console.error("[auth] sendVerificationRequest failed", error);
    }

    throw error;
  }
}

export const authOptions: NextAuthOptions = {
  secret: authSecret,
  adapter: PrismaAdapter(prisma),
  logger: {
    error(code, ...message) {
      console.error("[auth] next-auth error:", code, ...message);
    },
    warn(code, ...message) {
      if (!isProduction) {
        console.warn("[auth] next-auth warn:", code, ...message);
      }
    },
    debug(code, ...message) {
      if (!isProduction) {
        console.debug("[auth] next-auth debug:", code, ...message);
      }
    }
  },
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/login",
    error: "/login"
  },
  providers: [
    EmailProvider({
      server: emailServer || "smtp://localhost:1025",
      from: emailFrom || "SecurityQ <noreply@example.com>",
      sendVerificationRequest
    })
  ],
  callbacks: {
    async signIn({ user, email }) {
      // Email provider calls signIn twice: once during verification request,
      // then again after the magic link is consumed.
      if (email?.verificationRequest) {
        return true;
      }

      let resolvedUserId: string | null =
        typeof user.id === "string" && user.id.trim().length > 0 ? user.id : null;
      if (!resolvedUserId && user.email) {
        const existingUser = await prisma.user.findUnique({
          where: {
            email: user.email
          },
          select: {
            id: true
          }
        });
        resolvedUserId = existingUser?.id ?? null;
      }

      if (!resolvedUserId) {
        if (!isProduction) {
          console.error("[auth] signIn failed: user ID unavailable after email callback", {
            email: user.email ?? null
          });
        }
        return false;
      }

      try {
        await ensureUserOrganizationMembership({
          userId: resolvedUserId,
          email: user.email ?? null,
          name: user.name ?? null
        });
      } catch (error) {
        console.error("[auth] ensureUserOrganizationMembership failed during sign-in", error);
        if (isProduction) {
          return false;
        }
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.sub === "string") {
        session.user.id = token.sub;
      }

      return session;
    }
  }
};

export const authRouteHandler = NextAuth(authOptions);

export async function auth() {
  try {
    return await getServerSession(authOptions);
  } catch (error) {
    if (process.env.NODE_ENV === "test") {
      return null;
    }

    throw error;
  }
}
