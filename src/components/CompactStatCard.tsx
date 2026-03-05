import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
import { cx } from "@/components/ui";

export type CompactStatTone = "default" | "success" | "warning" | "danger" | "neutral";

type CompactStatCardProps = {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: CompactStatTone;
  clickable?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  loading?: boolean;
  icon?: ReactNode;
  className?: string;
};

export function CompactStatCard({
  label,
  value,
  sublabel,
  tone = "default",
  clickable = false,
  href,
  onClick,
  loading = false,
  icon,
  className
}: CompactStatCardProps) {
  const isInteractive = Boolean(href || onClick);
  const cardClassName = cx(
    "compact-stat-card",
    `tone-${tone}`,
    (clickable || isInteractive) && "compact-stat-card-interactive",
    className
  );

  const content = (
    <>
      <div className="compact-stat-label-row">
        {icon ? <span className="compact-stat-icon">{icon}</span> : null}
        <span className="compact-stat-label">{label}</span>
      </div>
      <div className={cx("compact-stat-value", loading && "is-loading")}>{loading ? "..." : value}</div>
      {sublabel ? <div className="compact-stat-sublabel">{sublabel}</div> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cardClassName} aria-busy={loading ? "true" : undefined}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={cardClassName} onClick={onClick} aria-busy={loading ? "true" : undefined}>
        {content}
      </button>
    );
  }

  return (
    <div className={cardClassName} aria-busy={loading ? "true" : undefined}>
      {content}
    </div>
  );
}
