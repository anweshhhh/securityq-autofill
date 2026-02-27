import { PrismaAdapter } from "@auth/prisma-adapter";
import { createTransport } from "nodemailer";
import NextAuth, { type NextAuthOptions, getServerSession } from "next-auth";
import EmailProvider, { type SendVerificationRequestParams } from "next-auth/providers/email";
import { ensureUserOrganization } from "@/lib/organizationMembership";
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
      console.info(`MAGIC LINK (dev): ${url}`);
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
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    EmailProvider({
      server: emailServer || "smtp://localhost:1025",
      from: emailFrom || "SecurityQ <noreply@example.com>",
      sendVerificationRequest
    })
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.id) {
        return false;
      }

      await ensureUserOrganization({
        userId: user.id,
        email: user.email ?? null,
        name: user.name ?? null
      });
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
