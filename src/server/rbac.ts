export type Role = "OWNER" | "ADMIN" | "REVIEWER" | "VIEWER";

export const RbacAction = {
  VIEW_DOCUMENTS: "VIEW_DOCUMENTS",
  UPLOAD_DOCUMENTS: "UPLOAD_DOCUMENTS",
  DELETE_DOCUMENTS: "DELETE_DOCUMENTS",
  EMBED_DOCUMENTS: "EMBED_DOCUMENTS",
  VIEW_QUESTIONNAIRES: "VIEW_QUESTIONNAIRES",
  IMPORT_QUESTIONNAIRES: "IMPORT_QUESTIONNAIRES",
  DELETE_QUESTIONNAIRES: "DELETE_QUESTIONNAIRES",
  RUN_AUTOFILL: "RUN_AUTOFILL",
  EXPORT: "EXPORT",
  APPROVE_ANSWERS: "APPROVE_ANSWERS",
  EDIT_APPROVED_ANSWERS: "EDIT_APPROVED_ANSWERS",
  MARK_NEEDS_REVIEW: "MARK_NEEDS_REVIEW"
} as const;

export type RbacAction = (typeof RbacAction)[keyof typeof RbacAction];

const ROLE_WEIGHT: Record<Role, number> = {
  VIEWER: 1,
  REVIEWER: 2,
  ADMIN: 3,
  OWNER: 4
};

const ACTION_MIN_ROLE: Record<RbacAction, Role> = {
  [RbacAction.VIEW_DOCUMENTS]: "VIEWER",
  [RbacAction.UPLOAD_DOCUMENTS]: "ADMIN",
  [RbacAction.DELETE_DOCUMENTS]: "ADMIN",
  [RbacAction.EMBED_DOCUMENTS]: "ADMIN",
  [RbacAction.VIEW_QUESTIONNAIRES]: "VIEWER",
  [RbacAction.IMPORT_QUESTIONNAIRES]: "ADMIN",
  [RbacAction.DELETE_QUESTIONNAIRES]: "ADMIN",
  [RbacAction.RUN_AUTOFILL]: "ADMIN",
  [RbacAction.EXPORT]: "VIEWER",
  [RbacAction.APPROVE_ANSWERS]: "REVIEWER",
  [RbacAction.EDIT_APPROVED_ANSWERS]: "REVIEWER",
  [RbacAction.MARK_NEEDS_REVIEW]: "REVIEWER"
};

export function getRequiredRole(action: RbacAction): Role {
  return ACTION_MIN_ROLE[action];
}

export function can(role: Role, action: RbacAction): boolean {
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT[getRequiredRole(action)];
}

export class ForbiddenRoleError extends Error {
  readonly code = "FORBIDDEN_ROLE";
  readonly status = 403;
  readonly requiredRole: Role;
  readonly action: RbacAction;

  constructor(params: { role: Role; action: RbacAction; requiredRole: Role }) {
    super(`Requires ${params.requiredRole} role.`);
    this.name = "ForbiddenRoleError";
    this.requiredRole = params.requiredRole;
    this.action = params.action;
  }
}

export function assertCan(role: Role, action: RbacAction): void {
  const requiredRole = getRequiredRole(action);
  if (!can(role, action)) {
    throw new ForbiddenRoleError({
      role,
      action,
      requiredRole
    });
  }
}
