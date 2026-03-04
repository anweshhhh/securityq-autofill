# Direction B Acceptance Criteria

Status: Release gate for Direction B UI implementation.
Scope: `/login`, `/documents`, `/questionnaires`, `/questionnaires/[id]`.

## 1) Review Velocity Targets

### 1.1 Found-Question Throughput
- Scenario: reviewer processes 50 `FOUND` questions using keyboard + auto-advance.
- Pass criterion:
  - total time <= 3 minutes.

### 1.2 Evidence Interaction
- Scenario: open evidence and copy selected snippet for current question.
- Pass criterion:
  - <= 2 clicks total from selected queue row state.

### 1.3 Reference Copy
- Scenario: copy all references (`DocName#ChunkId`) for selected question.
- Pass criterion:
  - <= 1 click from `References` tab open state.

### 1.4 Export Path
- Scenario: export `Approved only` from `/questionnaires/[id]`.
- Pass criterion:
  - <= 2 clicks from page loaded state (not counting browser file-save confirmation).

## 2) Accessibility Gates
- Automated axe gate (serious + critical only):
  - `/login`: 0 serious, 0 critical
  - `/documents`: 0 serious, 0 critical
  - `/questionnaires`: 0 serious, 0 critical
  - `/questionnaires/[id]`: 0 serious, 0 critical

## 3) Stability Gates
- UI audit console:
  - 0 console errors/warnings across audited pages.
- UI audit network:
  - 0 network failures across audited pages.

## 4) Functional Direction-B Behavior Gates

### 4.1 Single Primary CTA
- Exactly one primary CTA present in `/questionnaires/[id]` top bar at a time.
- CTA state switches by rule:
  - `Run autofill` when questionnaire has no generated answers for visible rows.
  - otherwise `Approve next`.

### 4.2 Queue-First Interaction
- Queue is the primary interaction surface.
- Heavy row actions are absent from queue rows.
- Selected row is singular and explicit.

### 4.3 Auto-Advance
- `Approve` and `Needs review` actions auto-advance to the next visible row.
- No jump to hidden/non-filter-matching rows.

### 4.4 Drawer/Sheet Behavior
- Desktop: right drawer.
- Mobile: bottom sheet.
- Tabs exist and function:
  - `Answer`, `Evidence`, `References`.

### 4.5 Keyboard Contract
- `J/K/Enter/A/R/U/C/?/` all work as specified.
- Shortcuts are ignored while typing in editable controls.

## 5) Measurement Protocol
- Use deterministic seed data with at least 50 `FOUND` questions.
- Record:
  - timing with screen capture or scripted timer,
  - click counts via Playwright instrumentation/logging,
  - axe and console/network outputs per route.
- Store artifacts under `artifacts/ui-audit/<timestamp>/` and reference in PR.

## 6) Non-Pass Conditions
Fail Direction B acceptance if any of the following occur:
- throughput target missed for 50 found questions,
- any serious/critical axe violation,
- any console warning/error,
- any network failure,
- shortcuts trigger while typing in input fields,
- queue lacks deterministic auto-advance.

## Next Actions
- [ ] Attach acceptance evidence per PR in rollout plan.
- [ ] Re-run full gate after B4 before merge-to-main.
