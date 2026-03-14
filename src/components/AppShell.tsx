"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppAuthzProvider, type AppAuthzState } from "@/components/AppAuthzContext";
import { Button, cx } from "@/components/ui";
import { can, RbacAction, type Role } from "@/server/rbac";

type AppShellProps = {
  devMode: boolean;
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  activeWhen: (pathname: string) => boolean;
};

type PageMeta = {
  kicker: string;
  title: string;
  subtitle: string;
  compact?: boolean;
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

function isPublicRoute(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/accept-invite");
}

function getPageMeta(pathname: string): PageMeta {
  if (pathname.startsWith("/review/library")) {
    return {
      kicker: "Review",
      title: "Library",
      subtitle: "Reusable reviewer decisions with freshness, provenance, and reuse context."
    };
  }

  if (pathname.startsWith("/review")) {
    return {
      kicker: "Review",
      title: "Inbox",
      subtitle: "Prioritized reviewer work across stale approvals, unresolved answers, and blocked runs."
    };
  }

  if (pathname.startsWith("/questionnaires/")) {
    return {
      kicker: "Review",
      title: "Review Workbench",
      subtitle: "Queue, answer, and evidence aligned in one focused decision surface.",
      compact: true
    };
  }

  if (pathname === "/questionnaires") {
    return {
      kicker: "Questionnaires",
      title: "Questionnaires",
      subtitle: "Run imports, autofill, and exports without losing review context."
    };
  }

  if (pathname.startsWith("/evidence") || pathname.startsWith("/documents")) {
    return {
      kicker: "Evidence",
      title: "Evidence",
      subtitle: "Keep source material current, healthy, and grounded for reviewer decisions."
    };
  }

  if (pathname.startsWith("/settings")) {
    return {
      kicker: "Settings",
      title: "Workspace",
      subtitle: "Manage access, governance, and the team around the active workspace."
    };
  }

  if (pathname.startsWith("/ask")) {
    return {
      kicker: "Developer",
      title: "Ask",
      subtitle: "One-off grounded answer checks for debugging retrieval and prompt quality."
    };
  }

  return {
    kicker: "Attestly",
    title: "Review-first questionnaire operations",
    subtitle: "Evidence-backed review workflows for security teams."
  };
}

function getPrimaryAction(pathname: string, role: Role | null): { href: string; label: string } | null {
  if (pathname === "/questionnaires") {
    if (!role || !can(role, RbacAction.IMPORT_QUESTIONNAIRES)) {
      return null;
    }

    return {
      href: "/questionnaires#import",
      label: "Import questionnaire"
    };
  }

  if (pathname.startsWith("/evidence") || pathname.startsWith("/documents")) {
    if (!role || !can(role, RbacAction.UPLOAD_DOCUMENTS)) {
      return null;
    }

    return {
      href: "/evidence#upload",
      label: "Upload evidence"
    };
  }

  if (pathname.startsWith("/settings")) {
    if (!role || !can(role, RbacAction.INVITE_MEMBERS)) {
      return null;
    }

    return {
      href: "/settings#invite-member",
      label: "Invite member"
    };
  }

  if (pathname.startsWith("/ask")) {
    return {
      href: "/ask",
      label: "Run question"
    };
  }

  return null;
}

function getAvatarLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "AT";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return normalized.slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function AppShell({ devMode, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const devRoleSwitcherEnabled = devMode && process.env.NODE_ENV !== "production";
  const isPublic = isPublicRoute(pathname);
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
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState("");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      {
        href: "/review/inbox",
        label: "Review",
        activeWhen: (route) => route.startsWith("/review") || route.startsWith("/questionnaires/")
      },
      {
        href: "/questionnaires",
        label: "Questionnaires",
        activeWhen: (route) => route === "/questionnaires"
      },
      {
        href: "/evidence",
        label: "Evidence",
        activeWhen: (route) => route.startsWith("/evidence") || route.startsWith("/documents")
      },
      {
        href: "/settings",
        label: "Settings",
        activeWhen: (route) => route.startsWith("/settings")
      }
    ];

    if (devMode) {
      items.push({
        href: "/ask",
        label: "Ask",
        activeWhen: (route) => route.startsWith("/ask")
      });
    }

    return items;
  }, [devMode]);

  const subnavItems = useMemo<NavItem[]>(() => {
    if (pathname.startsWith("/review") || pathname.startsWith("/questionnaires/")) {
      return [
        {
          href: "/review/inbox",
          label: "Inbox",
          activeWhen: (route) => route === "/review" || route.startsWith("/review/inbox") || route.startsWith("/questionnaires/")
        },
        {
          href: "/review/library",
          label: "Library",
          activeWhen: (route) => route.startsWith("/review/library")
        }
      ];
    }

    if (pathname.startsWith("/settings")) {
      return [
        {
          href: "/settings",
          label: "Members",
          activeWhen: (route) => route.startsWith("/settings")
        }
      ];
    }

    return [];
  }, [pathname]);

  const pageMeta = getPageMeta(pathname);
  const sectionTabs = subnavItems.length > 1 ? subnavItems : [];
  const primaryAction = getPrimaryAction(pathname, authzState.role);
  const accountEmail = session?.user?.email ?? authzState.userEmail ?? "Signed in";
  const accountOrgName = authzState.orgName ?? "Workspace";
  const accountRole = authzState.role ?? "Unknown";
  const avatarLabel = getAvatarLabel(accountOrgName);

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

  async function handleWorkspaceSwitch(nextOrgId: string) {
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
      setWorkspaceSwitchError(error instanceof Error ? error.message : "Failed to switch workspace.");
    } finally {
      setIsWorkspaceSwitching(false);
    }
  }

  const accountMenu = status === "authenticated" ? (
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
          {avatarLabel}
        </span>
        <span className="account-menu-org" title={accountOrgName}>
          {accountOrgName}
        </span>
        {authzState.role ? <span className="account-menu-role">{authzState.role}</span> : null}
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
                onChange={(event) => {
                  void handleWorkspaceSwitch(event.target.value);
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
            <Link href="/settings" className="account-menu-action" onClick={() => closeAccountMenu()}>
              Settings
            </Link>
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
    <Link href="/login" className="btn btn-secondary">
      Sign in
    </Link>
  );

  if (isPublic) {
    return (
      <div className="app-shell app-shell-public">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <header className="public-site-header">
          <div className="shell-container public-site-header-inner">
            <Link href="/" className="brand-lockup">
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-copy">
                <strong>Attestly</strong>
                <span>Trusted questionnaire review</span>
              </span>
            </Link>

            {pathname === "/" ? (
              <nav className="public-site-nav" aria-label="Public navigation">
                <a href="#workflow">Workflow</a>
                <a href="#control-center">Control center</a>
                <a href="#proof">Proof</a>
              </nav>
            ) : (
              <div className="public-site-nav">
                <Link href="/">Back to overview</Link>
              </div>
            )}

            <div className="public-site-actions">
              {status === "authenticated" ? (
                <Link href="/review/inbox" className="btn btn-primary">
                  Open workspace
                </Link>
              ) : (
                <>
                  <Link href="/login" className="btn btn-secondary">
                    Sign in
                  </Link>
                  <Link href="/login" className="btn btn-primary">
                    Enter review center
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" className="public-main">
          <AppAuthzProvider value={authzState}>
            <div className="shell-container public-main-inner">{children}</div>
          </AppAuthzProvider>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-private">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="product-site-header">
        <div className="shell-container product-site-header-inner">
          <Link href="/review/inbox" className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-copy">
              <strong>Attestly</strong>
              <span>Review-first trust platform</span>
            </span>
          </Link>

          <nav className="product-main-nav" aria-label="Primary">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cx("product-main-nav-link", item.activeWhen(pathname) && "active")}
                aria-current={item.activeWhen(pathname) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="product-site-actions">
            {primaryAction ? (
              <Link href={primaryAction.href} className="btn btn-primary">
                {primaryAction.label}
              </Link>
            ) : null}
            {accountMenu}
          </div>
        </div>

      </header>

      <main id="main-content" className="product-main">
        <AppAuthzProvider value={authzState}>
          <div className="shell-container product-main-inner">
            <header className={cx("product-page-intro", pageMeta.compact && "product-page-intro-compact")}>
              <span className="product-page-kicker">{pageMeta.kicker}</span>
              <div className="product-page-copy">
                <h1>{pageMeta.title}</h1>
                <p>{pageMeta.subtitle}</p>
              </div>
              {sectionTabs.length > 0 ? (
                <nav className="product-page-tabs" aria-label="Section">
                  {sectionTabs.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cx("product-page-tab-link", item.activeWhen(pathname) && "active")}
                      aria-current={item.activeWhen(pathname) ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
            </header>
            <div className="page-content-stack">{children}</div>
          </div>
        </AppAuthzProvider>
      </main>
    </div>
  );
}
