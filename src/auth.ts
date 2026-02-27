import { PrismaAdapter } from "@auth/prisma-adapter";
import { createTransport } from "nodemailer";
import NextAuth, { type NextAuthOptions, getServerSession } from "next-auth";
import EmailProvider, { type SendVerificationRequestParams } from "next-auth/providers/email";
import { ensureUserOrganization } from "@/lib/organizationMembership";
import { prisma } from "@/lib/prisma";

const isProduction = process.env.NODE_ENV === "production";

const emailServer = process.env.EMAIL_SERVER ?? "smtp://localhost:1025";
const emailFrom = process.env.EMAIL_FROM ?? "SecurityQ <noreply@example.com>";

async function sendVerificationRequest(params: SendVerificationRequestParams) {
  const { identifier, url, provider } = params;

  if (!isProduction) {
    console.info(`[auth] Magic link for ${identifier}: ${url}`);
    return;
  }

  if (!process.env.EMAIL_SERVER || !process.env.EMAIL_FROM) {
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
      server: emailServer,
      from: emailFrom,
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
