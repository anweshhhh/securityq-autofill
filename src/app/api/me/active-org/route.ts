import { NextResponse } from "next/server";
import { jsonError, toApiErrorResponse } from "@/lib/apiResponse";
import { setActiveOrgForUser } from "@/lib/organizationMembership";
import { getRequestContext } from "@/lib/requestContext";

export const runtime = "nodejs";

type SetActiveOrgBody = {
  organizationId?: unknown;
};

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request);
    const payload = (await request.json().catch(() => null)) as SetActiveOrgBody | null;
    const organizationId =
      typeof payload?.organizationId === "string" ? payload.organizationId.trim() : "";

    if (!organizationId) {
      return jsonError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "organizationId is required."
      });
    }

    const activeOrg = await setActiveOrgForUser(ctx.userId, organizationId);
    if (!activeOrg) {
      return jsonError({
        status: 403,
        code: "FORBIDDEN_ORG_SWITCH",
        message: "You do not have membership in the requested organization."
      });
    }

    return NextResponse.json({
      ok: true,
      activeOrg: {
        id: activeOrg.orgId,
        name: activeOrg.orgName
      },
      role: activeOrg.role
    });
  } catch (error) {
    console.error("Failed to switch active organization", error);
    return toApiErrorResponse(error, "Failed to switch active organization.");
  }
}
