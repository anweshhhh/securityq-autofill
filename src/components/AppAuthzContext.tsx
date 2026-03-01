"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/server/rbac";

export type AppAuthzMembership = {
  orgId: string;
  orgName: string;
  role: Role;
};

export type AppAuthzState = {
  loading: boolean;
  userEmail: string | null;
  orgId: string | null;
  orgName: string | null;
  role: Role | null;
  memberships: AppAuthzMembership[];
};

const DEFAULT_AUTHZ_STATE: AppAuthzState = {
  loading: true,
  userEmail: null,
  orgId: null,
  orgName: null,
  role: null,
  memberships: []
};

const AppAuthzContext = createContext<AppAuthzState>(DEFAULT_AUTHZ_STATE);

export function AppAuthzProvider({
  value,
  children
}: {
  value: AppAuthzState;
  children: React.ReactNode;
}) {
  return <AppAuthzContext.Provider value={value}>{children}</AppAuthzContext.Provider>;
}

export function useAppAuthz() {
  return useContext(AppAuthzContext);
}
