import type { ReactNode } from "react";
import { Card, cx } from "@/components/ui";

type OperationalSummaryStat = {
  label: string;
  value: ReactNode;
  helper: string;
};

type OperationalSummaryBandProps = {
  kicker: string;
  summary: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  stats: OperationalSummaryStat[];
  className?: string;
};

export function OperationalSummaryBand({
  kicker,
  summary,
  note,
  actions,
  stats,
  className
}: OperationalSummaryBandProps) {
  return (
    <Card className={cx("ops-band", className)}>
      <div className="ops-band-copy">
        <span className="section-kicker">{kicker}</span>
        <p>{summary}</p>
        {note ? <div className="ops-band-note">{note}</div> : null}
        {actions ? <div className="ops-band-actions">{actions}</div> : null}
      </div>
      <div className="ops-band-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="ops-stat">
            <span className="ops-stat-label">{stat.label}</span>
            <strong className="ops-stat-value">{stat.value}</strong>
            <span className="ops-stat-helper">{stat.helper}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
