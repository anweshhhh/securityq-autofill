"use client";

import type { ReactNode } from "react";
import { Badge, Button, Card, cx } from "@/components/ui";

type CollapsibleInputSectionProps = {
  id: string;
  title: string;
  helperText: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  badgeLabel?: string;
  badgeTone?: "approved" | "review" | "draft" | "notfound";
  badgeTitle?: string;
  expandLabel?: string;
  collapseLabel?: string;
};

export function CollapsibleInputSection({
  id,
  title,
  helperText,
  expanded,
  onToggle,
  children,
  badgeLabel,
  badgeTone = "draft",
  badgeTitle,
  expandLabel = "Expand",
  collapseLabel = "Collapse"
}: CollapsibleInputSectionProps) {
  const contentId = `${id}-content`;
  const toggleLabel = expanded ? collapseLabel : expandLabel;

  return (
    <Card id={id} className={cx("collapsible-section", !expanded && "collapsed")}>
      <div className="card-title-row">
        <div className="collapsible-header-copy">
          <h2 style={{ marginBottom: 4 }}>{title}</h2>
          <p className="muted small collapsible-helper">{helperText}</p>
        </div>
        <div className="toolbar-row compact collapsible-header-actions">
          {badgeLabel ? (
            <Badge tone={badgeTone} title={badgeTitle}>
              {badgeLabel}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="collapsible-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-label={`${toggleLabel} ${title}`}
            title={toggleLabel}
          >
            {toggleLabel}
            <span className="collapsible-toggle-chevron" aria-hidden="true">
              {expanded ? "▲" : "▼"}
            </span>
          </Button>
        </div>
      </div>

      <div id={contentId} className="collapsible-section-body" hidden={!expanded}>
        {children}
      </div>
    </Card>
  );
}
