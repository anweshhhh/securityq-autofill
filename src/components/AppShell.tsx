"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button, TextInput, cx } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";

type AppShellProps = {
  devMode: boolean;
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  short: string;
};

function getPageHeader(pathname: string): { title: string; subtitle: string } {
  if (pathname === "/") {
    return {
      title: "Trust and Consistency Workspace",
      subtitle: "Evidence-first autofill for security questionnaires."
    };
  }

  if (pathname.startsWith("/documents")) {
    return {
      title: "Evidence Library",
      subtitle: "Upload source evidence, inspect chunk status, and keep documents clean."
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

  return {
    title: "SecurityQ Autofill",
    subtitle: "Evidence-first questionnaire workflows."
  };
}

function getPrimaryAction(pathname: string): { href: string; label: string } {
  if (pathname.startsWith("/documents")) {
    return {
      href: "/documents#upload",
      label: "Upload Evidence"
    };
  }

  if (pathname.startsWith("/questionnaires/")) {
    const questionnaireId = pathname.split("/")[2];
    if (questionnaireId) {
      return {
        href: `/api/questionnaires/${questionnaireId}/export`,
        label: "Export CSV"
      };
    }
  }

  if (pathname === "/questionnaires") {
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

  return {
    href: "/questionnaires",
    label: "Open Questionnaires"
  };
}

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

export function AppShell({ devMode, children }: AppShellProps) {
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLElement | null>(null);

  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = [
      { href: "/", label: "Home", short: "H" },
      { href: "/documents", label: "Documents", short: "D" },
      { href: "/questionnaires", label: "Questionnaires", short: "Q" }
    ];

    if (devMode) {
      items.push({ href: "/ask", label: "Ask", short: "A" });
    }

    return items;
  }, [devMode]);

  const pageHeader = getPageHeader(pathname);
  const primaryAction = getPrimaryAction(pathname);

  useFocusTrap({
    active: isMobileSidebarOpen,
    containerRef: mobileSidebarRef,
    onEscape: () => setIsMobileSidebarOpen(false)
  });

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
          <span aria-hidden>{item.short}</span>
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
            <span className="sidebar-product-name">SecurityQ</span>
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
                <span className="sidebar-product-name">SecurityQ</span>
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
            <div className="top-nav-search">
              <TextInput
                type="search"
                readOnly
                placeholder="Search questionnaires, evidence, citations (coming soon)"
                aria-label="Global search (coming soon)"
              />
            </div>
            <Link href={primaryAction.href} className="btn btn-primary" aria-label={primaryAction.label}>
              {primaryAction.label}
            </Link>
          </nav>
        </header>

        <main id="main-content" className="canvas-area">
          <header className="page-header-band">
            <h1 id="page-title">{pageHeader.title}</h1>
            <p>{pageHeader.subtitle}</p>
          </header>

          <div className="canvas-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
