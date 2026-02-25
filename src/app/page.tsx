import Link from "next/link";
import { Badge, Card, cx } from "@/components/ui";

export default function Home() {
  const isDevMode = process.env.DEV_MODE === "true";

  return (
    <div className="page-stack">
      <Card className="card-shell">
        <div className="card-title-row">
          <h2 style={{ margin: 0 }}>SecurityQ Autofill</h2>
          <Badge tone="approved" title="Evidence-first trust mode">
            Evidence-first
          </Badge>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Ground every answer in uploaded evidence with citations that stay reviewable.
        </p>
        <div className="toolbar-row">
          <Link href="/documents" className={cx("btn", "btn-secondary")} title="Upload and manage evidence files">
            Manage Documents
          </Link>
          <Link href="/questionnaires" className="btn btn-primary" title="Import and run questionnaire workflows">
            Open Questionnaires
          </Link>
          {isDevMode ? (
            <Link href="/ask" className="btn btn-ghost">
              Ask (DEV)
            </Link>
          ) : null}
        </div>
      </Card>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Step 1</div>
          <div className="value">Ingest</div>
          <div className="muted small">Upload `.txt` and `.md`, then embed chunks.</div>
        </div>
        <div className="stat-card">
          <div className="label">Step 2</div>
          <div className="value">Autofill</div>
          <div className="muted small">Run answer engine across imported questionnaire rows.</div>
        </div>
        <div className="stat-card">
          <div className="label">Step 3</div>
          <div className="value">Review</div>
          <div className="muted small">Approve or flag answers and track citation coverage.</div>
        </div>
        <div className="stat-card">
          <div className="label">Step 4</div>
          <div className="value">Export</div>
          <div className="muted small">Download generated, approved-only, or preferred answers.</div>
        </div>
      </div>
    </div>
  );
}
