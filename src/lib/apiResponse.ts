import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/approvalValidation";
import { RequestContextError } from "@/lib/requestContext";
import { ForbiddenRoleError } from "@/server/rbac";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "FORBIDDEN_ROLE"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export function jsonError(params: {
  status: number;
  code: ApiErrorCode | string;
  message: string;
  requiredRole?: string;
  details?: unknown;
}) {
  return NextResponse.json(
    {
      error: {
        code: params.code,
        message: params.message,
        ...(params.requiredRole ? { requiredRole: params.requiredRole } : {}),
        ...(params.details !== undefined ? { details: params.details } : {})
      }
    },
    { status: params.status }
  );
}

export function toApiErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof ForbiddenRoleError) {
    return jsonError({
      status: error.status,
      code: error.code,
      message: error.message,
      requiredRole: error.requiredRole
    });
  }

  if (error instanceof RequestContextError) {
    return jsonError({
      status: error.status,
      code: error.code,
      message: error.message
    });
  }

  if (error instanceof ApiRouteError) {
    return jsonError({
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details
    });
  }

  return jsonError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: fallbackMessage
  });
}
