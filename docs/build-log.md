# Build Log

Current log of implemented MVP work (concise, execution-focused).

## 2026-02-24 - PR-01 DEV_MODE gating

- Added `DEV_MODE` (default `false`) and gated debug/noise features behind it.
- `/ask` is inaccessible when `DEV_MODE=false`.
- Debug UI/response payloads require `DEV_MODE=true`.
- Debug persistence requires `DEV_MODE=true` and `DEBUG_EVIDENCE=true`.

## 2026-02-24 - PR-02 Unified answer engine

- Consolidated answering into shared `src/server/answerEngine.ts`.
- Both `POST /api/questions/answer` and `POST /api/questionnaires/:id/autofill` call the same engine.
- Deterministic retrieval/rerank path:
  - vector topK=12
  - lexical overlap scoring
  - combined score `0.7 * vector + 0.3 * lexical`
  - topN=5 selected context
- Guardrails preserved:
  - empty citations => strict `Not found in provided documents.`
  - insufficient evidence => strict `Not found in provided documents.`

## 2026-02-24 - PR-03/04/05 MVP cleanup

- Simplified questionnaire flow to import -> autofill -> review -> export.
- Removed archive/rerun/resume complexity from API/UI.
- Cleaned test suite to MVP contract tests with deterministic OpenAI mocks.
- Prisma cleanup completed:
  - removed questionnaire run-state/archive leftovers
  - removed `Question.notFoundReason`, `Question.confidence`, `Question.needsReview`
- Cleanup verification runbook passed:
  - `docker compose up -d`
  - `npx prisma migrate deploy`
  - `npm test`
  - `npm run build`

## 2026-02-25 - Phase 1 approval workflow

### Schema and DB

- Added `Question.reviewStatus` (`DRAFT | NEEDS_REVIEW | APPROVED`, default `DRAFT`).
- Expanded `ApprovedAnswer` to approved override payload:
  - `answerText`
  - `citationChunkIds`
  - `source` (`GENERATED | MANUAL_EDIT`)
  - `approvedBy`, `note`, `createdAt`, `updatedAt`
- Enforced 1:1 via unique `ApprovedAnswer.questionId`.
- Migration preserved existing data.

### APIs

- Added/updated routes:
  - `POST /api/approved-answers`
  - `PATCH /api/approved-answers/:id`
  - `DELETE /api/approved-answers/:id`
  - `POST /api/questions/:id/review`
- Validation guardrails:
  - citations required for approved/edit flows
  - citation chunk IDs must exist and belong to the question org
- `GET /api/questionnaires/:id` now includes per question:
  - `reviewStatus`
  - `approvedAnswer` (`id`, `answerText`, `citationChunkIds`, `source`, `note`, `updatedAt`)

### UI and export

- `/questionnaires/[id]` now supports:
  - approve, edit approved answer/citations, unapprove
  - mark needs review / draft
  - status badges and status filters
- Export supports modes:
  - default `preferApproved`
  - `approvedOnly`
  - `generated`

### Tests

- Added deterministic integration coverage for:
  - import -> autofill -> approve/edit/review/unapprove
  - export mode behavior
  - cross-org citation validation failures

## 2026-02-25 - Answer normalization clobber bug fix

- Added regressions for claim-check clobber path:
  - `src/server/normalizeAnswerOutput.bug.test.ts`
  - `src/server/answerEngine.test.ts` positive control
- Fixed normalization invariant:
  - if sufficiency is true, missing points empty, citations valid/non-empty, and grounded draft is affirmative,
  - claim-check cannot downgrade answer to `Not specified...` or `Not found...`
  - answer is preserved with review/confidence downgrade allowed.
- Preserved strict fallbacks:
  - empty citations => NOT_FOUND
  - invalid format => NOT_FOUND
  - sufficiency false => NOT_FOUND

## 2026-02-25 - Tooling

- Added `scripts/scorecard.ts` and `npm run scorecard -- <path>`.
- Scorecard reports FOUND/PARTIAL/NOT_FOUND counts, citation compliance, and per-category breakdown from exported CSV.

## 2026-02-25 - UI refresh and polish (D-Dark Shell)

- Introduced dark shell + light workbench design system and app shell.
- Updated `/`, `/documents`, `/questionnaires`, `/questionnaires/[id]` for clearer review workflows.
- Improved interaction polish:
  - stronger focus states, cleaner feedback banners, sticky review/evidence panels, and better long-text readability.
- Refined Saved Questionnaires usability:
  - styled search control with explicit clear action
  - action hierarchy with visible primary actions (`Open`, `Run Autofill`)
  - overflow `More` menu for export/delete actions
  - no hidden horizontal-scroll action discovery

## 2026-02-25 - ui-next-01-wire-approval-state

- `/questionnaires/[id]` is now fully wired to persisted approval state from `GET /api/questionnaires/:id`:
  - uses `reviewStatus` + `approvedAnswer` from payload
  - normalized client state (`questionsById` + ordered IDs) for stable selection/filter behavior
- Added review status counts including `Not found`, and a new `Not found` filter chip in the left rail.
- Actions now execute persisted API flows and reconcile from server response:
  - Approve -> `POST /api/approved-answers` (or `PATCH /api/approved-answers/:id` when already approved)
  - Needs Review/Draft -> `POST /api/questions/:id/review`
  - Unapprove -> `DELETE /api/approved-answers/:id`
  - Edit approved answer -> `PATCH /api/approved-answers/:id` with citations preserved and validated non-empty
- Added approved-vs-generated comparison behavior:
  - approved answer shown as primary when available
  - `Show Generated`/`Show Approved` toggle for read-only comparison
  - evidence panel follows the currently displayed answer mode
- Strengthened error UX:
  - actionable message banners on failures
  - action buttons disabled while requests are in flight to prevent double submit

## 2026-02-25 - ui-next-02-review-velocity

- Added a sticky Trust Bar on `/questionnaires/[id]` with:
  - counts (`Approved`, `Needs review`, `Draft`, `Not found`)
  - approved-progress percentage bar
  - primary actions: `Export`, `Run Autofill`, `Approve Visible`
- Added bulk approve flow scoped to current filter/search:
  - `Approve Visible` only includes questions that are:
    - not already approved
    - not strict NOT_FOUND
    - backed by non-empty citations
  - confirmation modal shows eligible count and citation warning before execution
  - bulk approvals persist through existing approval APIs and refresh from server state
- Added keyboard shortcuts with discoverable `?` help modal:
  - `J/K` next/previous question
  - `A` approve selected (eligible only)
  - `R` mark needs review
  - `U` unapprove
  - `C` copy answer
  - `E` focus evidence panel
  - shortcuts are ignored while typing in inputs/textarea/select
- Added lightweight loading skeletons for rail/main/evidence sections during initial questionnaire fetch.
- Added focus target and ARIA labeling for evidence panel and high-frequency actions.

## 2026-02-25 - ui-next-03-evidence-panel-polish

- Evidence panel citation chips now show:
  - `DocName`
  - short chunk suffix (`...<last 6 chars>`)
  - per-chip actions: `Copy ID`, `Open Doc`
- Snippet viewer improvements:
  - question-term highlight (lightweight client-side matching; no extra library)
  - `Copy Snippet` button
  - `Copy All Citations` button (IDs)
- Rendering stability/readability:
  - long snippets remain in bounded scroll containers
  - line breaks preserved in snippet/document viewers
  - monospace retained for IDs only (`mono-id`), not snippet body text
- Added document-open fallback via read-only modal (no document detail page exists today):
  - loaded through `GET /api/documents/:id`
  - displays reconstructed full document text from stored chunks
  - includes `Copy Document Text`
- Kept ingestion logic unchanged.

## 2026-02-25 - ui-next-04-export-ux

- Added shared export modal UX (`src/components/ExportModal.tsx`) used by:
  - `/questionnaires` via `More -> Export...`
  - `/questionnaires/[id]` via `Export`
- Added mode selector with one-line explanations:
  - `Prefer approved` (default)
  - `Approved only`
  - `Generated only`
- Export now downloads through client flow with:
  - progress spinner while request is active
  - success/error banner messaging from page state
  - graceful API error handling from JSON/text responses
- Download naming is now client-controlled and deterministic:
  - `<questionnaire-name>-<YYYY-MM-DD>-export.csv` (sanitized base name)
- Reused existing backend export modes; no server behavior changes required.

## 2026-02-25 - ui-next-05-accessibility-perf-audit

- Accessibility hardening:
  - strengthened dark-shell state contrast for sidebar links and shell buttons while preserving palette
  - added focus-visible outlines for row actions, questionnaire rail items, and search clear controls
  - added/normalized `aria-label` coverage for native buttons and icon controls
- Focus + modal behavior:
  - introduced `useFocusTrap` hook (`src/lib/useFocusTrap.ts`)
  - applied focus trapping + `Esc` close to:
    - mobile sidebar drawer
    - export modal
    - questionnaire details modals (bulk approve, shortcuts, document preview)
- Performance hardening on `/questionnaires/[id]`:
  - added deferred search input (`useDeferredValue`) for large lists
  - memoized question rail row component and rail item projection
  - rail continues rendering preview-only question text (no full answer/snippet rendering per row)
- Cross-page consistency:
  - aligned `/documents` empty inventory state to gradient chrome empty-state pattern used in questionnaire surfaces
  - retained shared card + table primitives across `/documents` and `/questionnaires` list views

## 2026-02-26 - ui-audit-questionnaire-page automation

- Added automated questionnaire UI audit script:
  - `scripts/ui_audit_questionnaire.js`
  - npm command: `npm run ui:audit -- <url>`
- Added UI audit dependencies:
  - `playwright` (dev dependency)
  - `@axe-core/playwright` (dev dependency)
- Script outputs per run:
  - screenshots at desktop/tablet/mobile breakpoints
  - console warnings/errors
  - network failures (request failures + HTTP >= 400)
  - DOM assertions for workbench shell/panels
  - axe accessibility summary + full raw results
- Added minimal stable selectors (non-invasive `data-testid`) for audit assertions:
  - app sidebar nav
  - questionnaire question rail panel
  - main answer panel
  - evidence panel
- Executed audit:
  - URL: `http://localhost:3000/questionnaires/cmm0zazy5000ggp4qxjq8sokv`
  - artifacts: `artifacts/ui-audit/2026-02-26T00-49-21-703Z`
  - console errors/warnings: `0`
  - network failures: `0`
  - DOM assertions: `4/4` passed
  - axe violations: `3` (`1 serious`, `2 moderate`)

## 2026-02-26 - ui-a11y-fix-landmarks-progressbar

- Landmarks + progressbar accessibility fixes (semantic-only, no business logic changes):
  - App shell now exposes explicit landmarks:
    - skip link (`Skip to main content`)
    - sidebar navigation landmark (`aria-label="Sidebar"`)
    - top navigation within a header (`<nav aria-label="Primary">`)
    - single `<main id="main-content">` wrapping primary page content
  - Trust Bar progress meter now has an accessible name/value:
    - `aria-label` + `aria-labelledby`
    - `aria-valuetext` (e.g., `72% approved`)
- Re-ran validation:
  - `npm test` => PASS
  - `npm run build` => PASS
  - `npm run ui:audit -- http://localhost:3000/questionnaires/cmm0zazy5000ggp4qxjq8sokv`
    - artifacts: `artifacts/ui-audit/2026-02-26T01-06-55-257Z`
    - console errors/warnings: `0`
    - network failures: `0`
    - DOM assertions: `4/4` passed
    - axe violations: `0`

## Latest validation

- `npm test` => PASS
- `npm run build` => PASS
