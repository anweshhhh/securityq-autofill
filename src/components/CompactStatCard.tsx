import { cx } from "@/components/ui";

export type CompactStatTone = "default" | "success" | "warning" | "danger" | "neutral";

type CompactStatCardProps = {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: CompactStatTone;
  className?: string;
};

export function CompactStatCard({
  label,
  value,
  sublabel,
  tone = "default",
  className
}: CompactStatCardProps) {
  return (
    <div className={cx("compact-stat-card", `tone-${tone}`, className)}>
      <span className="compact-stat-label">{label}</span>
      <div className="compact-stat-value">{value}</div>
      {sublabel ? <div className="compact-stat-sublabel">{sublabel}</div> : null}
    </div>
  );
}
