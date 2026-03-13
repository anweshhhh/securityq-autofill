"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppAuthzProvider, type AppAuthzState } from "@/components/AppAuthzContext";
import { Button, cx } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { can, RbacAction, type Role } from "@/server/rbac";

type AppShellProps = {
  devMode: boolean;
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  short: string;
};

type MePayload = {
  user?: {
    id?: string;
    email?: string | null;
  };
  org?: {
    id?: string;
    name?: string;
  };
  role?: Role;
  memberships?: Array<{
    orgId: string;
    orgName: string;
    role: Role;
  }>;
};

type ActiveOrgSwitchPayload = {
  ok?: boolean;
  activeOrg?: {
    id?: string;
    name?: string;
  };
  role?: Role;
  error?: {
    message?: string;
  };
};

const ROLE_OPTIONS: Role[] = ["OWNER", "ADMIN", "REVIEWER", "VIEWER"];

function getPageHeader(pathname: string): { title: string; subtitle: string } {
  if (pathname === "/") {
    return {
      title: "Workspace",
      subtitle: "Evidence-first questionnaire automation."
    };
  }

  if (pathname.startsWith("/documents")) {
    return {
      title: "Evidence Library",
      subtitle: "Upload source evidence, inspect chunk status, and keep documents clean."
    };
  }

  if (pathname.startsWith("/approved-answers")) {
    return {
      title: "Approved Answers",
      subtitle: "Browse reusable claims with freshness and provenance metadata."
    };
  }

  if (pathname.startsWith("/trust-queue")) {
    return {
      title: "Trust Queue",
      subtitle: "Review stale approvals and needs-review items across the active workspace."
    };
  }

  if (pathname === "/questionnaires") {
    return {
      title: "Questionnaire Pipeline",
      subtitle: "Import CSV questionnaires, run autofill, review outcomes, and export."
    };
  }

  if (pathname.startsWith("/questionnaires/")) {
    return {
      title: "Review Workbench",
      subtitle: "Inspect each answer, evaluate citations, and approve confident responses."
    };
  }

  if (pathname.startsWith("/ask")) {
    return {
      title: "Single Question Debug",
      subtitle: "Run one-off evidence-grounded answer checks."
    };
  }

  if (pathname.startsWith("/settings/members")) {
    return {
      title: "Members",
      subtitle: "Manage workspace members and role-scoped access."
    };
  }

  if (pathname.startsWith("/accept-invite")) {
    return {
      title: "Organization Invite",
      subtitle: "Review and accept your workspace invitation."
    };
  }

  return {
    title: "SecurityQ Autofill",
    subtitle: "Evidence-first questionnaire workflows."
  };
}

function getPrimaryAction(pathname: string, role: Role | null): { href: string; label: string } | null {
  if (pathname === "/") {
    return null;
  }

  if (pathname.startsWith("/documents")) {
    if (!role || !can(role, RbacAction.UPLOAD_DOCUMENTS)) {
      return null;
    }
    return {
      href: "/documents#upload",
      label: "Upload Evidence"
    };
  }

  if (pathname.startsWith("/approved-answers")) {
    return null;
  }

  if (pathname.startsWith("/trust-queue")) {
    return null;
  }

  if (pathname.startsWith("/questionnaires/")) {
    return null;
  }

  if (pathname === "/questionnaires") {
    if (!role || !can(role, RbacAction.IMPORT_QUESTIONNAIRES)) {
      return null;
    }
    return {
      href: "/questionnaires#import",
      label: "Import Questionnaire"
    };
  }

  if (pathname.startsWith("/ask")) {
    return {
      href: "/ask",
      label: "Run Question"
    };
  }

  if (pathname.startsWith("/settings/members")) {
    if (!role || !can(role, RbacAction.INVITE_MEMBERS)) {
      return null;
    }
    return {
      href: "/settings/members#invite-member",
      label: "Send Invite"
    };
  }

  if (pathname.startsWith("/accept-invite")) {
    return null;
  }

  return {
    href: "/questionnaires",
    label: "Open Questionnaires"
  };
}

function getPageFocus(pathname: string): string {
  if (pathname === "/") {
    return "Move from evidence intake to export without losing review context.";
  }

  if (pathname.startsWith("/documents")) {
    return "Keep source evidence clean, current, and ready for answer generation.";
  }

  if (pathname.startsWith("/approved-answers")) {
    return "Build a fresh, reusable library of approved security responses.";
  }

  if (pathname.startsWith("/trust-queue")) {
    return "Resolve stale approvals before they become workflow blockers.";
  }

  if (pathname === "/questionnaires") {
    return "Import, autofill, review, and export from one operating surface.";
  }

  if (pathname.startsWith("/questionnaires/")) {
    return "Review every answer with the evidence, freshness, and actions in reach.";
  }

  if (pathname.startsWith("/ask")) {
    return "Debug retrieval quality with one grounded question at a time.";
  }

  if (pathname.startsWith("/settings/members")) {
    return "Keep the right teammates in the loop with role-scoped access.";
  }

  return "Evidence-backed operations for security questionnaire teams.";
}

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

export function AppShell({ devMode, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const devRoleSwitcherEnabled = devMode && process.env.NODE_ENV !== "production";
  const [authzState, setAuthzState] = useState<AppAuthzState>({
    loading: true,
    userEmail: null,
    orgId: null,
    orgName: null,
    role: null,
    memberships: []
  });
  const [isDevRoleSwitching, setIsDevRoleSwitching] = useState(false);
  const [isWorkspaceSwitching, setIsWorkspaceSwitching] = useState(false);
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<string>("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLElement | null>(null);
  const accountMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = [
      { href: "/", label: "Home", short: "H" },
      { href: "/documents", label: "Documents", short: "D" },
      { href: "/questionnaires", label: "Questionnaires", short: "Q" },
      { href: "/approved-answers", label: "Approved Answers", short: "L" },
      { href: "/trust-queue", label: "Trust Queue", short: "T" }
    ];

    if (authzState.role && can(authzState.role, RbacAction.INVITE_MEMBERS)) {
      items.push({ href: "/settings/members", label: "Members", short: "M" });
    }

    if (devMode) {
      items.push({ href: "/ask", label: "Ask", short: "A" });
    }

    return items;
  }, [authzState.role, devMode]);

  const pageHeader = getPageHeader(pathname);
  const pageFocus = getPageFocus(pathname);
  const primaryAction = getPrimaryAction(pathname, authzState.role);
  const canViewMembers = authzState.role ? can(authzState.role, RbacAction.VIEW_MEMBERS) : false;
  const accountEmail = session?.user?.email ?? authzState.userEmail ?? "Signed in";
  const accountOrgName = authzState.orgName ?? "Workspace";
  const accountRole = authzState.role ?? "Unknown";

  useFocusTrap({
    active: isMobileSidebarOpen,
    containerRef: mobileSidebarRef,
    onEscape: () => setIsMobileSidebarOpen(false)
  });

  const closeAccountMenu = useCallback((options?: { returnFocus?: boolean }) => {
    setIsAccountMenuOpen(false);
    if (options?.returnFocus) {
      window.requestAnimationFrame(() => {
        accountMenuTriggerRef.current?.focus();
      });
    }
  }, []);

  const loadAuthContext = useCallback(async () => {
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) {
        setAuthzState((current) => ({
          ...current,
          loading: false,
          role: null,
          orgId: null,
          orgName: null,
          memberships: []
        }));
        return;
      }

      const payload = (await response.json()) as MePayload;
      setAuthzState({
        loading: false,
        userEmail: typeof payload.user?.email === "string" ? payload.user.email : null,
        orgId: typeof payload.org?.id === "string" ? payload.org.id : null,
        orgName: typeof payload.org?.name === "string" ? payload.org.name : null,
        role: payload.role ?? null,
        memberships: Array.isArray(payload.memberships) ? payload.memberships : []
      });
    } catch {
      setAuthzState({
        loading: false,
        userEmail: null,
        orgId: null,
        orgName: null,
        role: null,
        memberships: []
      });
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      setAuthzState({
        loading: false,
        userEmail: null,
        orgId: null,
        orgName: null,
        role: null,
        memberships: []
      });
      setIsAccountMenuOpen(false);
      return;
    }

    void loadAuthContext();
  }, [loadAuthContext, status]);

  useEffect(() => {
    closeAccountMenu();
  }, [closeAccountMenu, pathname]);

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (accountMenuContainerRef.current?.contains(target)) {
        return;
      }

      closeAccountMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      closeAccountMenu({ returnFocus: true });
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAccountMenu, isAccountMenuOpen]);

  async function handleDevRoleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextRole = event.target.value as Role;
    if (!authzState.role || nextRole === authzState.role) {
      return;
    }

    setIsDevRoleSwitching(true);

    try {
      const response = await fetch("/api/dev/role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          role: nextRole
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        console.error("Failed to switch dev role", payload?.error?.message ?? response.statusText);
      }
    } catch (error) {
      console.error("Failed to switch dev role", error);
    } finally {
      await loadAuthContext();
      setIsDevRoleSwitching(false);
    }
  }

  function renderNavLinks(onNavigate?: () => void) {
    return navItems.map((item) => {
      const active = isActiveRoute(pathname, item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          className={cx("sidebar-link", active && "active")}
          onClick={onNavigate}
          aria-label={item.label}
        >
          <span className="sidebar-link-short" aria-hidden>
            {item.short}
          </span>
          <span className="sidebar-link-label">{item.label}</span>
        </Link>
      );
    });
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <nav
        className={cx("shell-sidebar", isSidebarCollapsed && "collapsed")}
        data-testid="app-sidebar"
        aria-label="Sidebar"
      >
        <div className="sidebar-title-row">
          <span className="sidebar-product">
            <span className="sidebar-product-dot" />
            <span className="sidebar-product-copy">
              <span className="sidebar-product-name">SecurityQ</span>
              <span className="sidebar-product-tag">Autofill OS</span>
            </span>
          </span>
          <Button
            type="button"
            variant="shell"
            className="icon-btn"
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? ">" : "<"}
          </Button>
        </div>
        <div className="sidebar-nav" data-testid="app-sidebar-nav" aria-label="Sidebar links">
          {renderNavLinks()}
        </div>
      </nav>

      {isMobileSidebarOpen ? (
        <>
          <button
            type="button"
            className="mobile-sidebar-overlay mobile-only"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-label="Close navigation drawer"
          />
          <nav
            className="shell-sidebar mobile-sidebar mobile-only"
            ref={mobileSidebarRef}
            tabIndex={-1}
            data-testid="app-sidebar-mobile"
            aria-label="Sidebar"
          >
            <div className="sidebar-title-row">
              <span className="sidebar-product">
                <span className="sidebar-product-dot" />
                <span className="sidebar-product-copy">
                  <span className="sidebar-product-name">SecurityQ</span>
                  <span className="sidebar-product-tag">Autofill OS</span>
                </span>
              </span>
              <Button
                type="button"
                variant="shell"
                className="icon-btn"
                onClick={() => setIsMobileSidebarOpen(false)}
                title="Close navigation"
                aria-label="Close navigation"
              >
                X
              </Button>
            </div>
            <div className="sidebar-nav" data-testid="app-sidebar-nav-mobile" aria-label="Sidebar links">
              {renderNavLinks(() => setIsMobileSidebarOpen(false))}
            </div>
          </nav>
        </>
      ) : null}

      <div className="shell-main">
        <header>
          <nav className="top-nav" aria-label="Primary">
            <Button
              type="button"
              variant="shell"
              className="icon-btn mobile-only"
              onClick={() => setIsMobileSidebarOpen(true)}
              title="Open navigation"
              aria-label="Open navigation"
            >
              =
            </Button>
            <div className="top-nav-brand">
              <strong>SecurityQ</strong>
              <span className="top-nav-sep">|</span>
              <span>{pageHeader.title}</span>
            </div>
            {primaryAction ? (
              <Link href={primaryAction.href} className="btn btn-primary" aria-label={primaryAction.label}>
                {primaryAction.label}
              </Link>
            ) : null}
            {status === "authenticated" ? (
              <div className="account-menu-container" ref={accountMenuContainerRef}>
                <button
                  ref={accountMenuTriggerRef}
                  type="button"
                  className={cx("account-menu-trigger", isAccountMenuOpen && "open")}
                  aria-haspopup="dialog"
                  aria-expanded={isAccountMenuOpen}
                  aria-label="Open user and workspace menu"
                  onClick={() => {
                    setWorkspaceSwitchError("");
                    setIsAccountMenuOpen((value) => !value);
                  }}
                >
                  <span className="account-menu-avatar" aria-hidden="true">
                    U
                  </span>
                  <span className="account-menu-org" title={accountOrgName}>
                    {accountOrgName}
                  </span>
                  {authzState.role ? <span className="account-menu-role">{authzState.role}</span> : null}
                  <span className="account-menu-chevron" aria-hidden="true">
                    {isAccountMenuOpen ? "▲" : "▼"}
                  </span>
                </button>

                {isAccountMenuOpen ? (
                  <div className="account-menu-popover" role="dialog" aria-label="User and workspace menu">
                    <div className="account-menu-meta">
                      <div className="account-menu-meta-label">Email</div>
                      <div className="account-menu-meta-value" title={accountEmail}>
                        {accountEmail}
                      </div>
                    </div>
                    <div className="account-menu-meta">
                      <div className="account-menu-meta-label">Workspace</div>
                      <div className="account-menu-meta-value" title={accountOrgName}>
                        {accountOrgName}
                      </div>
                    </div>
                    <div className="account-menu-meta">
                      <div className="account-menu-meta-label">Role</div>
                      <div className="account-menu-meta-value">{accountRole}</div>
                    </div>

                    {authzState.memberships.length > 1 ? (
                      <label className="account-menu-control">
                        <span className="account-menu-meta-label">Workspace switcher</span>
                        <select
                          className="input"
                          disabled={isWorkspaceSwitching}
                          value={authzState.orgId ?? authzState.memberships[0]?.orgId ?? ""}
                          onChange={async (event) => {
                            const nextOrgId = event.target.value;
                            if (!nextOrgId || nextOrgId === authzState.orgId) {
                              return;
                            }

                            setIsWorkspaceSwitching(true);
                            setWorkspaceSwitchError("");

                            try {
                              const response = await fetch("/api/me/active-org", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json"
                                },
                                body: JSON.stringify({
                                  organizationId: nextOrgId
                                })
                              });

                              const payload = (await response.json().catch(() => null)) as ActiveOrgSwitchPayload | null;
                              if (!response.ok || !payload?.ok || !payload.activeOrg?.id || !payload.activeOrg?.name) {
                                throw new Error(payload?.error?.message ?? "Failed to switch workspace.");
                              }

                              setAuthzState((current) => ({
                                ...current,
                                orgId: payload.activeOrg?.id ?? current.orgId,
                                orgName: payload.activeOrg?.name ?? current.orgName,
                                role: payload.role ?? current.role
                              }));

                              closeAccountMenu();
                              router.refresh();
                              await loadAuthContext();
                            } catch (error) {
                              setWorkspaceSwitchError(
                                error instanceof Error ? error.message : "Failed to switch workspace."
                              );
                            } finally {
                              setIsWorkspaceSwitching(false);
                            }
                          }}
                          aria-label="Workspace switcher"
                          title="Workspace switcher"
                        >
                          {authzState.memberships.map((membership) => (
                            <option key={membership.orgId} value={membership.orgId}>
                              {membership.orgName}
                              {membership.orgId === authzState.orgId ? " (Current)" : ""}
                            </option>
                          ))}
                        </select>
                        {workspaceSwitchError ? (
                          <div className="small account-menu-error" role="alert">
                            {workspaceSwitchError}
                          </div>
                        ) : null}
                      </label>
                    ) : null}

                    {devRoleSwitcherEnabled ? (
                      <label className="account-menu-control">
                        <span className="account-menu-meta-label">Dev role</span>
                        <select
                          className="input"
                          value={authzState.role ?? ""}
                          onChange={handleDevRoleChange}
                          disabled={isDevRoleSwitching || !authzState.role}
                          aria-label="Development role switcher"
                          title="Development role switcher"
                        >
                          {!authzState.role ? (
                            <option value="" disabled>
                              Loading
                            </option>
                          ) : null}
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <div className="account-menu-actions">
                      {canViewMembers ? (
                        <Link
                          href="/settings/members"
                          className="account-menu-action"
                          onClick={() => closeAccountMenu()}
                        >
                          Members
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        className="account-menu-action"
                        onClick={() => {
                          closeAccountMenu();
                          void signOut({ callbackUrl: "/login" });
                        }}
                        aria-label="Sign out"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link href="/login" className="btn btn-secondary" aria-label="Sign in">
                Sign in
              </Link>
            )}
          </nav>
        </header>

        <main id="main-content" className="canvas-area">
          <AppAuthzProvider value={authzState}>
            <div className="canvas-inner">
              <header className="page-header-band">
                <div className="page-header-copy">
                  <div className="page-header-kicker-row">
                    <span className="page-header-kicker">{accountOrgName}</span>
                    {authzState.role ? <span className="page-header-meta-pill">{accountRole}</span> : null}
                  </div>
                  <h1 id="page-title">{pageHeader.title}</h1>
                  <p>{pageHeader.subtitle}</p>
                </div>
                <div className="page-header-accent">
                  <span className="page-header-accent-label">Focus</span>
                  <strong>{pageFocus}</strong>
                </div>
              </header>
              <div className="page-content-stack">{children}</div>
            </div>
          </AppAuthzProvider>
        </main>
      </div>
    </div>
  );
}
