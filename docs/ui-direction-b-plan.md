# Direction B Rollout Plan (PR-Sized)

Status: Locked rollout sequence for implementation.
Direction: Inbox-First Review with Context Drawer.

## PR1 / B1: Queue-First Foundation (No Drawer Yet)
Goal:
- Convert `/questionnaires/[id]` into queue-first flow with sticky metrics, filters, search, and single-row selection.

Scope:
- Queue-first list layout.
- Sticky metrics strip with counts + approved progress + filters + search.
- Single selected-row model.
- Top bar single primary CTA state logic (spec-compliant).
- Keep existing details pane behavior temporary (until B2) but remove heavy row actions.

Out of scope:
- Drawer tabs.
- Mobile bottom-sheet.
- Full shortcut contract polish.

Acceptance for PR1:
- Queue renders preview-only rows.
- Exactly one selected row at a time.
- Filter + search are deterministic and preserve selection rules.

## PR2 / B2: Drawer Desktop + Bottom Sheet Mobile
Goal:
- Introduce contextual details surface with tabs and action area.

Scope:
- Desktop right drawer.
- Mobile bottom sheet with snap points.
- Tabs:
  - Answer
  - Evidence
  - References
- Action area in drawer:
  - Approve
  - Needs review
  - Unapprove
  - Edit approved (when allowed)
- Banner error/validation messaging in drawer.

Out of scope:
- Auto-advance optimization.
- Shortcut help polish.

Acceptance for PR2:
- Drawer/sheet opens from selected row.
- Tab behaviors match spec.
- Focus trap + ESC close + return focus.

## PR3 / B3: Throughput and Keyboard Polish
Goal:
- Maximize review velocity and keyboard-first flow.

Scope:
- Auto-advance after approve/unapprove/needs review.
- `Approve reused exact` path in Direction B layout.
- Shortcut contract:
  - `J/K/Enter/A/R/U/C/?/`.
- Shortcut help modal content and discoverability.
- Focus guards so shortcuts do not fire while typing.

Out of scope:
- Deep performance tuning.
- Final microcopy cleanup pass.

Acceptance for PR3:
- Auto-advance deterministic by visible queue ordering.
- Keyboard shortcuts pass functional checks.
- No typing-field shortcut conflicts.

## PR4 / B4: Performance, A11y, and Microcopy Hardening
Goal:
- Final quality gate for production readiness.

Scope:
- Performance hardening:
  - preview-only queue rendering,
  - lazy-load selected citation snippet.
- Full a11y audit pass on required routes.
- Microcopy consistency cleanup (labels/tooltips/banners).
- Console/network stability cleanup from audit findings.

Acceptance for PR4:
- Meets all criteria in `docs/ui-direction-b-acceptance.md`.
- 0 serious/critical axe issues.
- 0 console errors/warnings.
- 0 network failures.

---

## PR Checklist

### PR1 / B1 Checklist
- [ ] Queue-first list implemented with preview-only rows.
- [ ] Sticky metrics strip includes counts, progress, filters, search.
- [ ] Single selected-row model enforced.
- [ ] Exactly one primary CTA shown by state rule.
- [ ] Heavy row actions removed from queue rows.

### PR2 / B2 Checklist
- [ ] Desktop right drawer implemented.
- [ ] Mobile bottom sheet implemented with snap points.
- [ ] Tabs implemented: Answer / Evidence / References.
- [ ] Drawer action area implemented with permission-aware states.
- [ ] Drawer focus trap + ESC close + focus return implemented.

### PR3 / B3 Checklist
- [ ] Auto-advance after approve/unapprove/needs review implemented.
- [ ] `Approve reused exact` integrated in Direction B flow.
- [ ] Keyboard shortcuts implemented (`J/K/Enter/A/R/U/C/?/`).
- [ ] Shortcut input-focus guard implemented.
- [ ] Shortcut help modal updated.

### PR4 / B4 Checklist
- [ ] Queue preview rendering optimized.
- [ ] Citation snippet lazy-load behavior implemented.
- [ ] A11y audit passes (0 serious/critical).
- [ ] Console errors/warnings reduced to 0.
- [ ] Network failures reduced to 0.
- [ ] Microcopy consistency pass completed.

## Next Actions
- [ ] Start with PR1/B1 only; do not combine PR phases.
- [ ] Attach route-level audit artifacts to each PR.
- [ ] Block final merge unless PR4 checklist is fully green.
