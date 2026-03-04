# Direction B Spec: Inbox-First Review with Context Drawer

Status: Locked for implementation.
Scope: UI/UX behavior spec only. No backend/API/DB changes in this document.
Primary page: `/questionnaires/[id]`.

## 1) Page Spec: `/questionnaires/[id]` (Inbox-First)

### 1.1 Top Bar
Top bar must contain:
- Left: `Review Queue` title + questionnaire name.
- Center/right: exactly one primary CTA.
- Right overflow menu (`More`): secondary/destructive actions.

Primary CTA decision rule (single CTA):
- Show `Run autofill` when any of these are true:
  - questionnaire has `answeredCount === 0`, or
  - questionnaire has no generated answers for currently visible queue rows.
- Otherwise show `Approve next`.
- Permission fallback:
  - if user cannot run autofill, hide/disable `Run autofill` and keep next available permitted primary action.
  - if user cannot approve, hide/disable `Approve next` and promote best permitted action from overflow (non-destructive).

Overflow menu items (non-primary):
- `Export` (sub-menu modes):
  - `Generated answers`
  - `Approved only`
  - `Preferred (approved fallback generated)`
- `Delete questionnaire` (destructive, confirm required)
- Additional secondary actions remain here only (no duplication in primary CTA area).

### 1.2 Sticky Metrics Strip
Sticky strip sits below top bar and remains visible during queue scroll.

Contents:
- Counts:
  - `Approved`
  - `Needs review`
  - `Draft`
  - `Not found`
  - `Reused exact`
  - `Reused semantic`
- Progress:
  - approved progress bar with percentage text (`% approved`).
- Filters:
  - `All`
  - `Draft`
  - `Approved`
  - `Needs review`
  - `Not found`
  - `Reused` (includes both exact + semantic; optional secondary chip toggle for exact/semantic).
- Search input:
  - placeholder: `Search question text or answer preview`.
  - search applies to queue list only.

### 1.3 Queue List Row Spec (Single-Focus List)
Each queue row must contain:
- Left:
  - status pill: `Draft`, `Approved`, `Needs review`, `Not found`.
- Middle:
  - question preview truncated to 1-2 lines.
- Right:
  - optional reused badge: `Reused (exact)` or `Reused (semantic)`.
  - citations count badge (e.g., `3 citations`).
  - minimal row action icon: `Open` (opens drawer + selects row).

Heavy actions are not allowed on row level:
- No approve/unapprove/run autofill/export buttons inside each row.
- Those actions live in drawer actions or top bar/overflow only.

### 1.4 Selection Model
- Exactly one selected queue row at a time.
- Selected row state is visually strong and keyboard navigable.
- Opening drawer always binds to current selected row.

Auto-advance after action:
- After `Approve`: move selection to next visible eligible row.
- After `Needs review`: move selection to next visible row.
- After `Unapprove`: keep current row selected if still visible; otherwise next visible row.
- If no next row exists: keep selection on current row and show end-of-list hint.

Eligible row ordering:
- Use currently applied filter/sort/search view order only (no hidden reordering).

### 1.5 Drawer Spec
Desktop:
- Right-side drawer.
Mobile:
- Bottom sheet (see section 3).

Tabs:
- `Answer`
- `Evidence`
- `References`

Answer tab:
- Full answer text.
- `Copy answer` action.
- Show generated vs approved context when applicable.

Evidence tab:
- Citation chips list.
- Snippet viewer for selected citation.
- `Open document`.
- `Copy snippet`.

References tab:
- list in `DocName#ChunkId` format.
- `Copy ref` per row.
- `Copy all refs` action.

Drawer actions area:
- `Approve`
- `Needs review`
- `Unapprove`
- `Edit approved` (only if approved answer exists + role allows)

State rules:
- If answer is `NOT_FOUND`:
  - `Approve` disabled.
  - explain why in inline helper text.
- Validation and API failures:
  - show banner at drawer top with actionable message.
- All actions must reflect role permission states (disable + tooltip reason).

### 1.6 Performance Rules
- Queue list renders preview-only fields:
  - question preview
  - status
  - reuse badge
  - citations count
- Drawer content loading strategy:
  - default load: selected row answer + metadata.
  - lazy-load snippet text for selected citation only.
  - do not preload full citation snippets for all queue rows.

---

## 2) Page Spec: `/questionnaires` (List)
- Keep existing layout/flow unless needed to align with Direction B consistency.
- Consistency-only updates allowed in future UI PRs:
  - action hierarchy (single obvious primary, secondary in overflow).
  - copy consistency with review queue terminology.

Optional local-only enhancement:
- `Resume review` CTA.
- Behavior:
  - read last opened questionnaire ID from local state (`localStorage`),
  - validate still present in list,
  - open directly if valid.
- No backend persistence required.

---

## 3) Mobile Behavior
- Queue remains primary surface.
- Drawer transforms to bottom sheet:
  - supports snap points (`peek`, `half`, `full`).
  - default open at `half`.
  - expand to `full` for long answer/evidence reading.
- Keep top-level queue interactions available while sheet is collapsed.

---

## 4) Keyboard Shortcuts
Shortcuts:
- `J` = next row
- `K` = previous row
- `Enter` = open drawer (if closed)
- `A` = approve selected row
- `R` = mark needs review
- `U` = unapprove selected row
- `C` = copy answer (from selected/drawer context)
- `?` = open shortcuts help
- `/` = focus search input

Focus/input guard rules:
- Ignore shortcuts when focus is inside editable controls:
  - `input`, `textarea`, `select`, or `contenteditable`.
- `Esc` closes drawer/sheet first, then modals (LIFO behavior).
- Keyboard navigation must preserve visible focus indicator.

---

## 5) Accessibility Rules
Mandatory:
- Exactly one `<main>` on page.
- Drawer/bottom sheet:
  - focus trap while open,
  - `Esc` closes,
  - focus returns to invoking element.
- Progress bar:
  - explicit `aria-label` (or `aria-labelledby`) and current value.
- All icon-only controls:
  - `aria-label` required,
  - tooltip text aligned with action semantics.
- Tablist and tabs must be proper semantic roles with keyboard navigation.

---

## 6) Out-of-Scope (for this lock doc)
- API contract changes.
- DB schema updates.
- RBAC matrix changes.
- New backend endpoints.

## 7) Implementation Guardrails
- Preserve route structure and business logic.
- Do not hardcode questionnaire/document IDs.
- Keep D-Dark shell + light workbench theme direction.
- Keep accessibility and performance checks as release gates.

## Next Actions
- [ ] Implement B1 first (queue-first shell without drawer).
- [ ] Implement B2 drawer + mobile bottom sheet.
- [ ] Validate against `docs/ui-direction-b-acceptance.md` after each PR.
