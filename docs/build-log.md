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

## Latest validation

- `npm test` => PASS
- `npm run build` => PASS
