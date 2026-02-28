import { type MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { getActiveOrgForUser } from "@/lib/organizationMembership";

export const REQUEST_CONTEXT_UNAUTHORIZED = {
  code: "UNAUTHORIZED",
  message: "Authentication required."
} as const;

export class RequestContextError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code: string; status: number }) {
    super(message);
    this.name = "RequestContextError";
    this.code = options.code;
    this.status = options.status;
  }
}

export type RequestContext = {
  userId: string;
  orgId: string;
  role: MembershipRole;
};

export async function getRequestContext(_request?: Request): Promise<RequestContext> {
  const session = await auth();
  const userId = session?.user?.id?.trim();

  if (!userId) {
    throw new RequestContextError(REQUEST_CONTEXT_UNAUTHORIZED.message, {
      code: REQUEST_CONTEXT_UNAUTHORIZED.code,
      status: 401
    });
  }

  const activeOrg = await getActiveOrgForUser(userId);
  return {
    userId,
    orgId: activeOrg.orgId,
    role: activeOrg.role
  };
}
