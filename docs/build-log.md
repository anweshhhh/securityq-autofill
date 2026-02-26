# Build Log

Current log of implemented MVP work (concise, execution-focused).

## 2026-02-26 - phase2-reuse-02 approved-answer reuse test suite

- Added deterministic integration coverage for approved-answer reuse across questionnaires:
  - `src/app/api/questionnaires/approvedAnswer.reuse.integration.test.ts`
- Test flow implemented:
  - uploads `template_evidence_pack.txt`, embeds chunks
  - imports Questionnaire A (6 questions: TLS, MFA, AES+KMS, RPO, SOC2+TSC, ISO trick)
  - runs autofill A, approves Q1-Q5 (with citation checks), leaves ISO unapproved
  - imports Questionnaire B (4 overlaps from A Q1-Q4, 2 non-overlap questions, ISO trick)
  - runs autofill B and asserts overlap reuse, citation validity, and non-overlap non-reuse
  - safety scenario deletes a cited chunk from an approved answer, reruns B, and verifies invalid-citation approvals are not reused
- Evidence-first assertions enforced in test:
  - reused answers require non-empty citations
  - reused citation chunk IDs must exist and belong to the organization
  - no post-rerun reused answer may reference missing chunks
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - phase2-reuse-01 approved-answer reuse

- Implemented cross-questionnaire approved-answer reuse in autofill flow.
- Added `ApprovedAnswer` metadata for matching:
  - `normalizedQuestionText`
  - `questionTextHash`
  - `questionEmbedding` (`vector(1536)`)
- Added migration:
  - `prisma/migrations/20260226223000_phase2_approvedanswer_reuse/migration.sql`
- Approval routes now persist matching metadata + embedding on create/update:
  - `POST /api/approved-answers`
  - `PATCH /api/approved-answers/:id`
- Added reusable matcher (`src/lib/approvedAnswerReuse.ts`) with deterministic matching order:
  1) exact hash/normalized text
  2) near-exact normalized text similarity
  3) semantic similarity via embedding threshold
- Evidence validity guardrail enforced for reuse:
  - all reused `citationChunkIds` must exist and belong to the same organization, or reuse candidate is rejected.
- Autofill output now surfaces reuse metadata:
  - `reusedCount`
  - `reusedFromApprovedAnswers[]` with approved answer IDs + match type.
- Regression coverage:
  - workflow integration test now covers two questionnaires where approvals from A are reused in B (`exact` + `semantic`) and unrelated questions still fall back to engine.
- Stability:
  - isolated default-org mocking added to `pdfOnly.autofill.regression` test to prevent cross-suite embedding availability collisions.
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - phase2-qa-01 pdf/txt parity regressions

- Added deterministic PDF/TXT parity regression suite:
  - `src/app/api/questionnaires/pdfTxt.parity.regression.test.ts`
- Added fixtures for parity validation:
  - `test/fixtures/template_evidence_pack.pdf` (selectable text)
  - `test/fixtures/template_evidence_pack.txt` (same evidence content)
  - `test/fixtures/template_questionnaire.csv` (31-question template)
- Regression assertions:
  - PDF flow (`upload -> embed -> autofill`) requires `foundCount >= 30` and strict ISO 27001 NOT_FOUND.
  - TXT flow requires same outcome.
  - Key controls must be FOUND with citations in both modes:
    - MFA
    - TLS minimum version
    - AES-256 + KMS
    - RPO/RTO
    - SOC 2 Type II + TSC
- Added chunk boundary unit coverage in `src/lib/chunker.test.ts` for token integrity:
  - `AES-256`, `KMS-managed`, `TLS 1.2+`
- Stability hardening:
  - parity suite runs in an isolated mocked organization to avoid cross-test 409s from shared embedding-availability checks.
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

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

## 2026-02-26 - phase2-01 PDF ingestion support

- Added `.pdf` support to evidence upload validation while keeping existing `.txt`/`.md` behavior unchanged.
- Added server-side PDF extraction in `src/lib/extractText.ts` using `pdf-parse` with per-page separators:
  - `--- Page N ---`
- Preserved existing ingestion pipeline semantics:
  - extract text -> deterministic chunking -> store `Document` + `DocumentChunk`
- Updated documents API/UI to surface document type cleanly:
  - upload accept list includes PDF
  - inventory shows a type badge (`PDF` / `MD` / `TXT`)
- Added deterministic ingestion contract coverage for PDF:
  - fixture: `test/fixtures/evidence-c.pdf`
  - verifies upload creates chunks and extracted chunk text contains expected phrases.
- Validation run:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - ui-polish-evidence-actions

- Polished evidence row actions in `/questionnaires/[id]` without logic changes:
  - retained chip content (`DocName + ...<chunkId suffix>`) with improved truncation behavior
  - switched per-citation actions to compact icon buttons (`Copy ID`, `Open Doc`) with tooltip titles
  - added dedicated action group layout to prevent awkward wrapping/truncation in narrow evidence panel widths
- Preserved existing features:
  - `Copy All Citations`
  - `Copy Snippet`
  - evidence snippet panel remains on light surface (no gradients behind long text)
- Accessibility:
  - explicit `aria-label` kept/added for per-citation action buttons
  - icon buttons include screen-reader text
- Validation:
  - `npm run ui:audit -- http://localhost:3000/questionnaires/cmm0zazy5000ggp4qxjq8sokv`
    - artifacts: `artifacts/ui-audit/2026-02-26T01-11-05-211Z`
    - console errors/warnings: `0`
    - network failures: `0`
    - DOM assertions: `4/4` passed
    - axe violations: `0`

## 2026-02-26 - ui-evidence-panel-compact

- Compact Evidence panel toolbar on `/questionnaires/[id]`:
  - header now shows `Evidence (N)` with compact icon actions
  - replaced tall stacked controls with single-row small controls:
    - copy citation IDs (newline format: `DocName#ChunkId`)
    - copy selected snippet
    - copy evidence pack (answer + citation refs + selected snippet)
- Citation chips now prioritize readability:
  - chip text shows doc name only (ellipsized)
  - chunk IDs are no longer displayed in-chip
  - full `DocName#ChunkId` remains available via tooltip and copy-reference action
- Per-citation row actions remain compact and consistent:
  - copy reference
  - open document
- Evidence-first workflow preserved:
  - citations remain visible/clickable
  - selecting citation still drives snippet viewer
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS
  - `npm run ui:audit -- http://localhost:3000/questionnaires/cmm0zazy5000ggp4qxjq8sokv`
    - artifacts: `artifacts/ui-audit/2026-02-26T01-32-31-473Z`
    - console errors/warnings: `0`
    - network failures: `0`
    - DOM assertions: `4/4` passed
    - axe violations: `0`

## 2026-02-26 - ui-evidence-copy-ref-visibility

- Improved evidence action discoverability without reintroducing whitespace bloat:
  - added one always-visible compact header control: `Copy refs`
  - `Copy refs` copies all references as newline-separated `DocName#ChunkId`
  - retained icon-only secondary controls for `Copy selected snippet` and `Copy evidence pack`
- Per-citation row action visibility rules:
  - row actions remain inside each citation row, right-aligned
  - desktop: actions reveal on row hover/focus and remain visible for selected row
  - mobile: actions are always visible
  - row copy tooltip text now explicitly shows reference context (`Copy ref (Doc#Chunk)`)
- Kept chip labels doc-first (ellipsized doc name only); no chunk suffix shown in primary chip text.
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS
  - `npm run ui:audit -- http://localhost:3000/questionnaires/cmm0zazy5000ggp4qxjq8sokv` (run on clean dev server)
    - artifacts: `artifacts/ui-audit/2026-02-26T01-45-55-316Z`
    - console errors/warnings: `0`
    - network failures: `0`
    - DOM assertions: `4/4` passed
    - axe violations: `0`

## 2026-02-26 - ui-evidence-tooltip-visibility

- Fixed evidence toolbar tooltip visibility for:
  - `Copy selected snippet`
  - `Copy evidence pack`
- Root cause: top-positioned tooltips were clipped near the panel header.
- Update:
  - header icon tooltips now render below the control (`tooltip-below` variant), preserving hover/focus visibility.
- Validation:
  - `npm run build` => PASS

## 2026-02-26 - debug-upload-unexpected-token

- Investigated UI error:
  - `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
- Root cause identified:
  - `POST /api/documents/upload` returned HTML 500 in dev because route module crashed during load.
  - Crash source was `pdf-parse` ESM import path (`pdfjs-dist/legacy/build/pdf.mjs`) throwing:
    - `TypeError: Object.defineProperty called on non-object`
  - Since the crash happened before handler execution, Next returned its HTML error page.
- Upload route hardening:
  - `src/app/api/documents/upload/route.ts` now sets `export const runtime = "nodejs"`.
  - Error responses standardized to JSON shape: `{ error: { message, code } }`.
  - Handler always returns JSON for expected failures and caught internal errors.
- PDF extraction fix:
  - `src/lib/extractText.ts` now lazily imports `pdf-parse/lib/pdf-parse.js` (avoids crashing ESM path in Next dev bundling).
  - Added `src/types/pdf-parse-lib.d.ts` for build-safe typing of that subpath.
- Client diagnostics:
  - `/documents` upload handler logs status/content-type in non-production.
  - If response is non-JSON, UI now reads text and surfaces the first 300 chars in the error banner.
- Repro/verification curl commands:
  - Before fix (observed):  
    `curl -i -X POST http://localhost:3000/api/documents/upload -F "file=@/Users/anweshsingh/Downloads/Attestly/securityq-autofill/test/fixtures/evidence-c.pdf"`  
    returned `500` with `Content-Type: text/html`.
  - After fix (observed): same command returns `201` with `Content-Type: application/json`.
  - Failure path check:  
    `curl -i -X POST http://localhost:3000/api/documents/upload -F "wrong=@/Users/anweshsingh/Downloads/Attestly/securityq-autofill/test/fixtures/evidence-a.txt"`  
    returns `400` JSON with `{ error: { message: "file is required", code: "UPLOAD_FILE_REQUIRED" } }`.
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - autofill auto-embed UX smoothing

- Updated questionnaire UI autofill actions to auto-run embeddings first via `POST /api/documents/embed`, then trigger questionnaire autofill.
- Applied on both screens:
  - `/questionnaires`
  - `/questionnaires/[id]`
- Behavior:
  - removes the manual “run embed then retry autofill” step for normal flows
  - if embedding fails, UI now reports explicit embedding-step failure before autofill
  - success banner includes embedded chunk count when new embeddings were generated
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - workbench live autofill progress

- Improved `/questionnaires/[id]` autofill UX for in-place review:
  - `Run Autofill` button now shows an inline live progress bar and counter (`answered/total`) while autofill is running.
  - Progress updates are driven by periodic questionnaire detail refresh during the running autofill job.
- Live data updates during run:
  - question rail, selected answer panel, and evidence panel now refresh incrementally as rows are answered.
  - final refresh is applied after completion to ensure latest state is visible.
- Added lightweight polling behavior only during active autofill; no backend contract changes.
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - phase2-pdf-coverage-diagnose

- Scope: diagnose why PDF-only runs return NOT_FOUND for questions that should be answerable.
- Target document (latest uploaded PDF):
  - `docId`: `cmm2usn6a000yffie77116mp5`
  - `name`: `template_evidence_pack`
  - `createdAt`: `2026-02-26T02:37:58.738Z`
- Chunk + embedding coverage:
  - `totalChunks`: `3`
  - `embeddedChunks`: `3`
  - `missingEmbeddingChunks`: `0`
- Phrase coverage search across `DocumentChunk.content`:
  - Found: `least privilege`, `restricted to authorized`, `quarterly`, `every 90 days`, `TLS 1.2`, `TLS 1.2+`, `mTLS`, `AES-256`, `KMS`, `PCI DSS`, `not applicable`
  - Not found: `AES 256` (space-only variant; hyphenated `AES-256` exists)
  - Sample matches:
    - `cmm2usnbq000zffieqdvoaipa`: `"Least privilege: Production access is restricted to authorized personnel ... Access recertification is performed quarterly (every 90 days) ..."`
    - `cmm2usnbq000zffieqdvoaipa`: `"All external endpoints require encryption in transit using TLS 1.2 or higher (TLS 1.2+) ... Internal services use mTLS ..."`
    - `cmm2usnbq000zffieqdvoaipa`: `"encrypted at rest using AES-256 ... via a centralized KMS ..."`
    - `cmm2usnbq0011ffie04vn80xm`: `"PCI DSS is not applicable because FinCo does not store, process, or transmit payment card data."`
- Extracted text sanity preview (first 800 chars) includes the expected IAM/encryption sections and control details.
- DEV debug runs (`/api/questions/answer?debug=true`) for failing-style questions:
  - `Is production access restricted ... least privilege?`
  - `What minimum TLS version ... and is mTLS used ...?`
  - `Are data at rest encrypted with AES-256 and managed through KMS?`
  - In all three runs:
    - `retrievedTopK`/`rerankedTopN` include the relevant PDF chunk IDs.
    - But `sufficiency.sufficient=false`, resulting in strict NOT_FOUND.
    - Example: TLS/mTLS run reported missing points despite chunk text containing both claims.
- Diagnosis conclusion:
  - (A) extraction missing sections: **NO** (key sections are present in chunks).
  - (B) chunking/truncation dropping content: **NO clear evidence** (key statements present in stored chunks/excerpts).
  - (C) missing embeddings: **NO** (`3/3` embedded).
  - (D) retrieval/rerank misses relevant chunks: **NO** (relevant chunks are retrieved/reranked).
  - Primary issue is downstream of retrieval: **sufficiency gate misclassification on PDF-derived snippets**.

## 2026-02-26 - phase2-gate-01-regression-tests

- Added PDF gate regression fixture:
  - `test/fixtures/evidence-gate.pdf` (selectable text including least-privilege, TLS 1.2+, mTLS, AES-256, KMS statements).
- Added failing regression test:
  - `src/server/answerEngine.pdfGate.regression.test.ts`
  - flow:
    - uploads PDF fixture
    - runs embed route
    - calls `answerQuestion(..., debug: true)` for 3 questions:
      - prod access restricted + least privilege
      - transit encryption + minimum TLS + mTLS
      - at-rest encryption + AES-256 + KMS
    - verifies relevant chunks are retrieved in `rerankedTopN`
    - verifies `sufficiency.sufficient === false`
    - expects non-NOT_FOUND + non-empty citations (intended future behavior)
- Current result (expected failing repro):
  - test fails because answers are strict `Not found in provided documents.` with empty citations for all 3 checks.
  - command: `npm test -- src/server/answerEngine.pdfGate.regression.test.ts`
  - representative failures:
    - `expected 'Not found in provided documents.' not to be ...`
    - `expected 0 to be greater than 0`
- No fix implemented in this step (tests-only PR step).

## 2026-02-26 - phase2-gate-02-extractor-gate

- Replaced brittle sufficiency boolean gate with extractor-based gate in the shared answer pipeline.
- New gate model output (from `generateEvidenceSufficiency` in `src/lib/openai.ts`):
  - `requirements: string[]`
  - `extracted: Array<{ requirement, value | null, supportingChunkIds[] }>`
  - `overall: FOUND | PARTIAL | NOT_FOUND`
- Prompt update:
  - explicitly forbids guessing
  - requires `null` when not present
  - requires supporting chunk IDs for every non-null extracted value
- Deterministic gate logic in `src/server/answerEngine.ts`:
  - `overall=NOT_FOUND` OR all extracted values null => strict NOT_FOUND
  - some non-null values but not all requirements satisfied => PARTIAL (`Not specified in provided documents.`) with citations from `supportingChunkIds`
  - all requirements satisfied => FOUND with citations from `supportingChunkIds`
- Evidence strictness preserved:
  - citations for FOUND/PARTIAL are filtered to selected reranked chunk IDs
  - empty/invalid citations still collapse to strict NOT_FOUND
- Retrieval/rerank unchanged.
- Normalization invariant updated:
  - FOUND + all requirements satisfied outcomes cannot be downgraded to NOT_FOUND/PARTIAL by claim-check clobber.
- Regression/tests updates:
  - updated answer engine and workflow mocks to extractor-gate shape
  - added/updated PDF regression to pass under extractor gate:
    - `src/server/answerEngine.pdfGate.regression.test.ts`
    - fixture: `test/fixtures/evidence-gate.pdf`
- Validation:
  - `npm test` => PASS (`16` tests)
  - `npm run build` => PASS

## 2026-02-26 - phase2-gate-04-diagnose-all-notfound

- Added targeted diagnostic harness:
  - `src/server/answerEngine.diagnose-all-notfound.test.ts`
  - gated execution via `RUN_EXTRACTOR_DIAGNOSE=true` so normal test runs are unaffected.
- Diagnostic run command:
  - `RUN_EXTRACTOR_DIAGNOSE=true npm test -- src/server/answerEngine.diagnose-all-notfound.test.ts`
  - persisted output: `artifacts/diagnose/extractor-gate-all-notfound-2026-02-26.txt`
- Scope:
  - used most recent org with documents and most recent questionnaire first question fallback
  - ran 3 categories:
    - IAM (`MFA/2FA privileged/admin`)
    - Encryption (`minimum TLS version`)
    - Compliance (`SOC 2 Type II`)
  - forced engine debug via `answerQuestion(..., debug: true)` independent of `DEV_MODE`.
- Stage findings (consistent across all 3 questions):
  - Retrieval is healthy:
    - `retrievedTopK` and `rerankedTopN` contain relevant evidence chunks.
  - Extractor path is executed:
    - OpenAI `chat/completions` request with extractor system prompt marker observed.
  - Raw extractor content parses as JSON, but schema is not the expected contract:
    - observed shapes:
      - `extracted` returned as object/map, not array of `{ requirement, value, supportingChunkIds }`
      - `supportingChunkIds` often returned as top-level field (or nested incorrectly), not per extracted item
      - `requirements` sometimes returned as object/map instead of string array
  - Because parser is strict-typed by shape, normalized extractor output collapses:
    - `parsed.requirements` non-array => `requirements=[]`
    - `parsed.extracted` non-array => `extracted=[]`
    - `allValuesNull=true` => normalized `overall=NOT_FOUND`
  - Decision logic then deterministically forces strict NOT_FOUND:
    - `gateDecision.overall === "NOT_FOUND"` => `returnNotFound("NO_RELEVANT_EVIDENCE")`
    - final answer becomes exact `Not found in provided documents.` with `0` citations.
- Root cause category:
  - **extractor called and JSON parse succeeds, but extractor output schema mismatch (shape drift) collapses to NOT_FOUND**.
- Responsible code locations:
  - strict extractor parsing + fallback-to-empty logic:
    - `src/lib/openai.ts:137-183`
    - `src/lib/openai.ts:201-226`
  - extractor gate decision forcing NOT_FOUND on empty extracted values:
    - `src/server/answerEngine.ts:462-484`
    - `src/server/answerEngine.ts:760-762`

## 2026-02-26 - phase2-gate-07-normalize-extractor-shapes

- Implemented tolerant extractor output normalization in:
  - `src/lib/openai.ts` (`normalizeExtractorOutput`)
- Normalizer now accepts common schema variants safely:
  - `requirements` as array/string/object-map
  - `extracted` as array or map (`requirement -> value` / `requirement -> { value|extractedValue, supportingChunkIds|chunkIds|chunks }`)
  - per-item supporting IDs from `supportingChunkIds|chunkIds|chunks`
  - top-level requirement-keyed supporting chunk maps (`supportingChunkIds|chunkIds`)
- Safety constraints preserved:
  - supporting chunk IDs are always filtered to allowed chunk IDs from current snippet set
  - invalid/hallucinated chunk IDs are dropped
  - no blanket propagation of top-level `supportingChunkIds` arrays to every extracted requirement
- Deterministic overall decision now occurs after normalization:
  - at least one valid extracted item (`value` + valid supporting chunk IDs) required for non-NOT_FOUND
  - otherwise `overall=NOT_FOUND` and output marked `extractorInvalid=true`
- Engine behavior update:
  - extractor-enabled path now falls back to legacy sufficiency gate when extractor output is marked invalid
  - this prevents shape-mismatch responses from collapsing every question to strict NOT_FOUND.
- Added unit coverage:
  - `src/lib/openai.normalizeExtractorOutput.test.ts`
  - cases covered:
    - extracted as map `requirement -> string`
    - extracted as map `requirement -> { value, supportingChunkIds }`
    - requirements as object-map
    - top-level supportingChunkIds array is not blindly applied to all extracted requirements
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - phase2-gate-08-safe-fallback-on-extractor-invalid

- Updated extractor-enabled path in `src/server/answerEngine.ts` to avoid global strict NOT_FOUND collapse from extractor schema mismatch:
  - when extractor output is marked invalid (`extractorInvalid=true`) and reranked context exists,
  - engine now falls back to grounded draft generation over the same reranked topN snippets.
- Safe fallback invariants:
  - fallback result is accepted only when:
    - grounded answer text is non-empty, and
    - grounded citations are non-empty after validation against chosen allowed chunk IDs.
  - invalid/missing citations still collapse to strict NOT_FOUND.
  - fallback output is returned with:
    - `needsReview=true`
    - `confidence="low"`
  - no template rewrite is applied on this fallback path.
- Evidence strictness preserved:
  - citations remain subset-validated against selected reranked chunk IDs only
  - non-NOT_FOUND answers with empty citations are never returned
  - true no-evidence branches continue to return strict NOT_FOUND.
- Added regression coverage in `src/server/answerEngine.test.ts`:
  - simulates extractor-invalid output from broken-but-parseable extractor shape
  - verifies engine does not collapse to strict NOT_FOUND when grounded draft includes valid citations.
- Validation:
  - `npm test` => PASS
  - `npm run build` => PASS

## 2026-02-26 - phase2-gate-09-tighten-extractor-prompt-schema

- Tightened extractor prompt contract in `src/lib/openai.ts` (`generateEvidenceSufficiency`):
  - requires exact top-level keys:
    - `requirements`
    - `extracted`
    - `overall`
  - requires strict schema text in prompt:
    - `requirements: string[]`
    - `extracted: Array<{ requirement: string, value: string | null, supportingChunkIds: string[] }>`
    - `overall: "FOUND" | "PARTIAL" | "NOT_FOUND"`
  - explicit instruction added:
    - `Do NOT use objects/maps for requirements or extracted. Use arrays only.`
  - explicit JSON-only constraint:
    - no prose, no markdown, no code fences
  - added minimal generic JSON example output (non-domain-specific).
- Added compact allowed chunk ID context in user prompt:
  - `allowedChunkIds (CSV): <id1,id2,...>`
  - keeps token footprint small while giving explicit valid citation set.
- Added unit test:
  - `src/lib/openai.extractorPrompt.test.ts`
  - asserts prompt includes strict schema requirements, no-maps instruction, and allowedChunkIds CSV line.
- Validation:
  - `npm test` => PASS

## 2026-02-26 - phase2-gate-10-validate-pdf-only-end-to-end

- Added PDF-only questionnaire autofill regression test:
  - `src/app/api/questionnaires/pdfOnly.autofill.regression.test.ts`
- Added fixture used by this flow:
  - `test/fixtures/template_evidence_pack.pdf`
- Flow executed in test:
  - upload PDF fixture (`POST /api/documents/upload`)
  - embed chunks (`POST /api/documents/embed`)
  - import questionnaire CSV (`POST /api/questionnaires/import`)
  - run autofill (`POST /api/questionnaires/:id/autofill`)
- Assertions:
  - required checks return non-NOT_FOUND answers with non-empty citations:
    - production access restricted + least privilege
    - minimum TLS version
    - AES-256 at rest + KMS
    - SOC 2 Type II + TSC
  - trick checks remain strict NOT_FOUND with empty citations.
- Before/after counts:
  - before (schema-drift diagnosis in phase2-gate-04): `FOUND=0`, `NOT_FOUND=3` for targeted PDF checks
  - after (this end-to-end autofill regression): `FOUND=4`, `NOT_FOUND=2`, `TOTAL=6`
- Validation:
  - `npm test` => PASS (`24` passed, `1` skipped)
  - `npm run build` => PASS

## Latest validation

- `npm test` => PASS
- `npm run build` => PASS
