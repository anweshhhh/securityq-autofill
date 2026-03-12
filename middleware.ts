import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

function isProtectedApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/dev") ||
    pathname.startsWith("/api/documents") ||
    pathname.startsWith("/api/org") ||
    pathname.startsWith("/api/questionnaires") ||
    pathname.startsWith("/api/questions") ||
    pathname.startsWith("/api/approved-answers") ||
    pathname.startsWith("/api/me")
  );
}

function isProtectedPagePath(pathname: string): boolean {
  return (
    pathname.startsWith("/approved-answers") ||
    pathname.startsWith("/documents") ||
    pathname.startsWith("/questionnaires") ||
    pathname.startsWith("/trust-queue") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/ask")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isProtectedApiPath(pathname) && !isProtectedPagePath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET
  });

  if (token) {
    return NextResponse.next();
  }

  if (isProtectedApiPath(pathname)) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required."
        }
      },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/approved-answers/:path*",
    "/documents/:path*",
    "/questionnaires/:path*",
    "/trust-queue/:path*",
    "/settings/:path*",
    "/ask/:path*",
    "/api/documents/:path*",
    "/api/org/:path*",
    "/api/dev/:path*",
    "/api/questionnaires/:path*",
    "/api/questions/:path*",
    "/api/approved-answers/:path*",
    "/api/me"
  ]
};
