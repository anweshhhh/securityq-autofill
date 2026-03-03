# D-Dark Shell UI Spec (Phase: ui-research-and-implement-ddark-shell)

## Scope
- Preserve architecture: dark shell chrome (`sidebar`, `top nav`, `header band`) + light workbench surfaces (`cards`, `tables`, `answer/evidence panels`).
- No backend or data-model changes.
- Improve clarity, density, and accessibility for navigation and questionnaire review workflows.

## Research Synthesis
Sources reviewed:
- Atlassian navigation best practices: [https://support.atlassian.com/navigation/docs/navigation-best-practices/](https://support.atlassian.com/navigation/docs/navigation-best-practices/)
- shadcn dashboard example: [https://ui.shadcn.com/examples/dashboard](https://ui.shadcn.com/examples/dashboard)
- shadcn sidebar docs: [https://ui.shadcn.com/docs/components/sidebar](https://ui.shadcn.com/docs/components/sidebar)
- WCAG contrast minimum: [https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- Material drawer references (M2/M3 URLs provided) are JS-gated in this environment; applied the supplied distilled principles for drawer structure/collapse behavior.

Actionable principles used:
- Keep primary navigation minimal and task-oriented; move infrequent destinations into overflow.
- Keep drawer behavior predictable: clear active state, smooth collapse, persistent orientation cues.
- Keep text-heavy work surfaces visually calm; use color for status and primary action, not decoration.
- Standardize spacing and component rhythm to reduce per-page one-off styles.
- Meet WCAG AA contrast targets: 4.5:1 for normal text, 3:1 for large text and UI controls.

## Information Architecture
Primary sidebar nav:
- `Documents`
- `Questionnaires`
- `Members` (settings entry)

Secondary/overflow nav (top bar menu):
- `Home`
- `Ask` (DEV only)

Label rules:
- Prefer task nouns (`Documents`, `Questionnaires`, `Members`) over implementation labels.
- Avoid duplicate destinations between sidebar and overflow.

## Layout Rules
Shell vs workbench boundaries:
- Shell = sidebar + top nav + page header band (dark chrome).
- Workbench = canvas area containing cards/tables/panels (light surfaces).

Widths and spacing:
- Sidebar expanded: ~248-260px, collapsed: ~64px.
- Workbench max width: preserve existing wide layout; reduce visual clutter via consistent inner spacing.
- Spacing scale tokens: `4, 8, 12, 16, 20, 24, 32` only.
- Radii and shadows from shared tokens only; no ad-hoc radius/shadow values on feature pages.

Sticky behavior:
- Trust bar stays sticky.
- Question rail and evidence panel stay sticky on desktop, stack naturally on mobile.

## Component Rules
Buttons:
- `primary`: one dominant action per cluster (run, approve, submit).
- `secondary`: supportive actions near primary.
- `ghost`: tertiary/non-destructive navigation actions.
- `danger`: destructive actions only.

Badges/status:
- Keep semantic mapping fixed: approved=green, review=amber, draft=neutral, not-found=red.
- Status badges should remain compact and legible at table/rail density.

Tables:
- Use one compact density baseline for list pages.
- Header and cell padding should be consistent across members/documents/questionnaires tables.

Panels:
- Question rail selected state must be obvious (contrast + border/focus ring).
- Answer and snippet containers require bounded height, pre-wrap, and overflow handling.

Drawer/sidebar:
- Collapsed mode still shows icon/initial affordance.
- Active item style must be visually distinct from hover and focus.

## Interaction Rules
- Hover states should be subtle and consistent (same transition timing and border emphasis).
- Focus-visible styling must be present for links, buttons, chips, and icon-only actions.
- Action clusters should keep primary action in a stable position.
- Loading states should avoid layout jump (button labels/spinners/progress regions keep stable dimensions).

## Accessibility Rules
- Exactly one `<main>` landmark.
- Top navigation wrapped in `<header><nav aria-label="Primary">`.
- Sidebar links wrapped in a navigation landmark with explicit label.
- Progress indicators require accessible names and value text (`aria-label`/`aria-labelledby` + value semantics).
- Contrast goals:
  - normal text >= 4.5:1
  - large text + UI controls >= 3:1

## Top 10 UI Issues And Fixes
1. Sidebar has too many first-class items (`Home` + task routes + dev route).
   - Fix: keep only task-critical items in sidebar; move secondary destinations to overflow menu.
2. Secondary navigation is scattered (dev/aux actions mixed with primary nav).
   - Fix: add explicit overflow menu in top bar for secondary routes.
3. Sidebar active vs hover contrast is close in some states.
   - Fix: strengthen active treatment (left indicator + stronger contrast + inset border).
4. Shell spacing tokens are implicit and inconsistent.
   - Fix: add explicit spacing/radius/shadow tokens and apply to shared classes.
5. Workbench trust bar action hierarchy is noisy.
   - Fix: normalize action order and primary/secondary emphasis.
6. Question rail selected-state hierarchy is weak when scanning dense lists.
   - Fix: stronger selected border/background and consistent row metadata layout.
7. Answer panel actions use mixed spacing and ad-hoc inline styles.
   - Fix: introduce dedicated toolbar classes and stable wrapping rules.
8. Evidence toolbar/actions have excess micro-spacing inconsistency.
   - Fix: tighten icon/button spacing and align control heights.
9. Long answer/snippet rendering can feel unstable between preview/expanded states.
   - Fix: enforce bounded containers, preserved line breaks, overflow wrapping, stable min-heights.
10. Audit coverage focuses on questionnaire internals and misses shell landmark checks.
   - Fix: add minimal audit assertions for shell/landmark presence.

## Implementation Checklist
- Navigation cleanup and overflow menu in `AppShell`.
- Shared tokenized style overrides for spacing/borders/radius/shadows.
- Workbench hierarchy/action polish in questionnaire details page.
- Evidence panel spacing refinement.
- Accessibility and audit assertion updates; run audit and record results.
