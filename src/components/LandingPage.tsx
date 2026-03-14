import Link from "next/link";

const WORKFLOW_STEPS = [
  {
    eyebrow: "Ingest",
    title: "Bring evidence and questionnaires into one review system.",
    body: "Upload source packs, import questionnaires, and keep each run attached to the documents that justify it."
  },
  {
    eyebrow: "Review",
    title: "Focus reviewers on what is risky instead of what is repetitive.",
    body: "An action-led inbox surfaces stale approvals, unanswered items, and the exact evidence behind every answer."
  },
  {
    eyebrow: "Reuse",
    title: "Turn strong decisions into a library that compounds over time.",
    body: "Approved answers stay reusable, traceable, and freshness-aware across future questionnaires."
  }
];

const CAPABILITIES = [
  {
    title: "Review-first inbox",
    description: "Route work by urgency, not by tab. The team starts with what can block trust or export readiness."
  },
  {
    title: "Evidence-grounded answers",
    description: "Every answer stays attached to citations, source snippets, and document lineage so reviewers can move quickly with confidence."
  },
  {
    title: "Reusable answer library",
    description: "Strong approvals become reusable building blocks instead of dead-end one-off edits."
  }
];

const PROOF_POINTS = [
  "Evidence-grounded review flows",
  "Freshness-aware approved answers",
  "Questionnaire-level export readiness",
  "Role-based workspace controls"
];

export function LandingPage() {
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-hero-copy">
          <span className="landing-kicker">Trusted questionnaire review</span>
          <h1 id="landing-hero-title">
            Turn security questionnaire work into a calm, review-first operating system.
          </h1>
          <p className="landing-lede">
            Evidence comes in once. Reviewers see what matters next. Approved answers stay reusable, fresh, and ready
            for export.
          </p>
          <div className="landing-actions">
            <Link href="/login" className="btn btn-primary">
              Enter the review center
            </Link>
            <a href="#workflow" className="btn btn-secondary">
              See the workflow
            </a>
          </div>
        </div>

        <div className="landing-hero-stage" aria-label="Product promise">
          <div className="landing-stage-card landing-stage-card-primary">
            <span className="landing-stage-label">Review center</span>
            <strong>Inbox, evidence, and reusable answers in one place.</strong>
            <p>
              Start with stale approvals and unresolved questions, then move straight into the workbench without
              context switching.
            </p>
          </div>
          <div className="landing-stage-card">
            <span className="landing-stage-label">Why teams use it</span>
            <ul className="landing-proof-list">
              {PROOF_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="landing-band" aria-label="Positioning">
        <p>
          Built for security teams who need faster questionnaire throughput without losing provenance, review discipline,
          or confidence.
        </p>
      </section>

      <section id="workflow" className="landing-section">
        <div className="landing-section-heading">
          <span className="landing-kicker">Workflow</span>
          <h2>One clear path from intake to trusted export.</h2>
        </div>
        <div className="landing-workflow-grid">
          {WORKFLOW_STEPS.map((step, index) => (
            <article key={step.title} className="landing-workflow-card">
              <span className="landing-step-index">0{index + 1}</span>
              <span className="landing-workflow-eyebrow">{step.eyebrow}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="control-center" className="landing-section landing-section-emphasis">
        <div className="landing-section-heading">
          <span className="landing-kicker">Control Center</span>
          <h2>Designed around real reviewer behavior, not dashboard filler.</h2>
        </div>
        <div className="landing-capability-grid">
          {CAPABILITIES.map((capability) => (
            <article key={capability.title} className="landing-capability-card">
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="proof" className="landing-section landing-cta">
        <div className="landing-cta-copy">
          <span className="landing-kicker">Ready to review</span>
          <h2>Enter the workspace and start from the inbox instead of a dashboard.</h2>
          <p>Use the existing evidence, questionnaires, and approvals already in this workspace.</p>
        </div>
        <Link href="/login" className="btn btn-primary">
          Sign in with magic link
        </Link>
      </section>
    </div>
  );
}
