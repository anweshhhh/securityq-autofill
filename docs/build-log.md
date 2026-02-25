# Build Log

This log now tracks only the current MVP pivot and recent implementation work.

## 2026-02-24 - PR-01 DEV_MODE gating

- Added `DEV_MODE` (default `false`) to gate debug/noise features.
- `/ask` is inaccessible when `DEV_MODE=false`.
- Debug UI and debug response payloads are hidden unless `DEV_MODE=true`.
- Debug persistence requires both `DEV_MODE=true` and `DEBUG_EVIDENCE=true`.

## 2026-02-24 - PR-02 unified answer engine

- Consolidated answering into shared `src/server/answerEngine.ts`.
- Both `POST /api/questions/answer` and questionnaire autofill use the same pipeline.
- Retrieval/answer flow is deterministic:
  - vector retrieval topK=12
  - lexical overlap scoring
  - combined rank score `0.7 * vector + 0.3 * lexical`
  - topN=5 context for sufficiency + answer generation
- Guardrails preserved:
  - empty citations => strict `Not found in provided documents.`
  - insufficient evidence => strict `Not found in provided documents.`
  - PARTIAL allowed as `Not specified in provided documents.` when evidence is relevant but incomplete.

## 2026-02-24 - PR-03 questionnaire workflow simplification

- Removed archive/rerun/resume complexity from API and UI.
- Kept minimal questionnaire flow:
  - CSV import + question column selection
  - run autofill
  - view per-question answers/citations
  - export CSV
- Dropped related run-state/archive DB fields and endpoints.

## 2026-02-24 - PR-04 test suite cleanup

- Removed legacy tests for deleted features and brittle document-template assumptions.
- Kept focused MVP contract tests:
  - ingestion contract
  - answer engine FOUND/NOT_FOUND/PARTIAL contract
  - questionnaire import -> autofill -> export -> delete contract
- Added lightweight fixtures under `test/fixtures`.
- OpenAI calls mocked for deterministic, network-independent test runs.

## 2026-02-24 - PR-05 Prisma cleanup

- Removed unused `Question` auxiliary metadata columns:
  - `notFoundReason`
  - `confidence`
  - `needsReview`
- Added migration:
  - `mvp_remove_question_aux_metadata`
- Kept `ApprovedAnswer` model and added TODO that approval reuse must evolve beyond strict `questionId` binding.

## 2026-02-24 - PR-CLEANUP-CHECK verification

- Audited pages, APIs, answer pipeline, schema, and tests against MVP requirements.
- Removed leftover `GET /api/health` surface.
- Removed leftover no-op category plumbing from answer layer exports.
- Verified runbook commands pass:
  - `docker compose up -d`
  - `npx prisma migrate deploy`
  - `npm test`
  - `npm run build`

## 2026-02-24 - Phase 1 planning (approval workflow) - no code changes

### Repository scan summary

1) Prisma models and relations (current)
- `Questionnaire`:
  - belongs to `Organization` via `organizationId`
  - has many `Question` via `questions`
  - stores CSV import metadata (`sourceFileName`, `questionColumn`, `sourceHeaders`, `totalCount`)
- `Question`:
  - belongs to `Questionnaire` via `questionnaireId`
  - stores generated answer state in `answer` + `citations`
  - has many `ApprovedAnswer` via `approvedAnswers`
  - unique index: `@@unique([questionnaireId, rowIndex])`
- `ApprovedAnswer`:
  - belongs to `Organization` via `organizationId`
  - belongs to `Question` via `questionId`
  - currently only stores `answer` and `createdAt`
  - TODO already present: evolve beyond strict `questionId` binding for reusable approvals

2) `GET /api/questionnaires/:id` response and UI rendering (current)
- Route: `src/app/api/questionnaires/[id]/route.ts` -> service `getQuestionnaireDetails`.
- Response shape:
  - `questionnaire`: `{ id, name, sourceFileName, questionColumn, questionCount, answeredCount, notFoundCount, createdAt, updatedAt }`
  - `questions[]`: `{ id, rowIndex, text, answer, citations }`
- UI (`/questionnaires/[id]`) renders:
  - summary counts from `questionnaire`
  - per-question table with `Row`, `Question`, `Answer`, `Citations`
  - filters: `All`, `Answered`, `Not Found`
  - no approval controls yet

3) Export endpoint behavior (current)
- Route: `GET /api/questionnaires/:id/export`.
- Data source: `Question.answer` and `Question.citations` only.
- Export builder appends deterministic columns:
  - `Answer`
  - `Citations` (formatted from citation objects)
- Export does not depend on `DEV_MODE` or debug payloads.

### Phase 1 implementation plan

1) Minimal schema changes (approval workflow)
- Extend `ApprovedAnswer` (instead of adding new model):
  - add `status` enum: `APPROVED | NEEDS_REVIEW | REJECTED`
  - add `citations` JSON column (approved/edited answer evidence payload)
  - add `updatedAt` (`@updatedAt`)
  - enforce single current approval record per question with `@unique` on `questionId`
- Keep `Question.answer` and `Question.citations` as generated baseline.
- Keep all fields generic; no document/question/org-specific assumptions.

2) API routes to add
- `PUT /api/questionnaires/:id/questions/:questionId/approval`
  - purpose: approve/edit/reject/needs-review via upsert
  - request:
    - `{ status: "APPROVED" | "NEEDS_REVIEW" | "REJECTED", answer: string, citations: Citation[] }`
  - validation:
    - for `APPROVED`/`NEEDS_REVIEW`: `answer` non-empty, `citations` non-empty
    - citation `chunkId`s must be valid against current question citation IDs
  - response:
    - `{ approval: { id, questionId, status, answer, citations, createdAt, updatedAt } }`
- `DELETE /api/questionnaires/:id/questions/:questionId/approval`
  - purpose: unapprove (remove approval override)
  - response:
    - `{ ok: true }`
- Extend `GET /api/questionnaires/:id` response:
  - include approval state for each question:
    - `approvedAnswer: { id, status, answer, citations, updatedAt } | null`

3) UI changes (`/questionnaires/[id]`)
- Add per-question approval controls:
  - Approve generated answer
  - Edit approved answer text
  - Edit approved citations
  - Mark as Needs Review
  - Reject
  - Unapprove (delete override)
- Add minimal filters:
  - `All`, `Approved`, `Needs Review`, `Rejected`, `Unapproved`
- Keep UI generic and data-driven for N questionnaires / N documents.

4) Export behavior (Phase 1)
- Default behavior: prefer approved answer when status is `APPROVED`; otherwise fall back to generated `Question.answer`.
- Citation source follows selected answer source:
  - approved path -> `ApprovedAnswer.citations`
  - fallback path -> `Question.citations`
- Optional query param:
  - `mode=generated|approved` (default `approved`)
- Export remains deterministic and independent of debug flags.

5) Tests required
- Prisma/service tests:
  - upsert approval
  - edit approval with valid citations
  - reject/needs-review status transitions
  - unapprove delete path
- API route tests:
  - approval validation errors on invalid/empty citations
  - citation `chunkId` validity enforcement
  - questionnaire details payload includes approval state
- Export tests:
  - approved-preferred default behavior
  - generated mode fallback behavior
  - deterministic output order and stable columns

### Anti-hardcode checklist (for this PR series)

- No hard-coded document names, questionnaire names, org IDs, filenames, or question text.
- No branching by exact question strings; use only model/state-driven logic.
- Validate citations by IDs from persisted evidence, not by ad hoc string heuristics.
- Keep all query scopes organization + questionnaire + question ID based.
- Ensure behavior is stable for multiple documents and questionnaires in the same org.

### Planned implementation files (Phase 1)

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_phase1_approval_workflow/migration.sql`
- `src/lib/questionnaireService.ts`
- `src/app/api/questionnaires/[id]/route.ts`
- `src/app/api/questionnaires/[id]/export/route.ts`
- `src/app/api/questionnaires/[id]/questions/[questionId]/approval/route.ts` (new)
- `src/app/questionnaires/[id]/page.tsx`
- `src/app/api/questionnaires/workflow.test.ts` (extend)
- `src/lib/export.ts` (if export mode switch lands here)
- `context.md`
- `docs/build-log.md`

## 2026-02-24 - Phase 1 schema implementation (Question.reviewStatus + ApprovedAnswer expansion)

### What changed

- Updated Prisma schema:
  - added enum `QuestionReviewStatus` with `DRAFT | NEEDS_REVIEW | APPROVED`
  - added enum `ApprovedAnswerSource` with `GENERATED | MANUAL_EDIT`
  - added `Question.reviewStatus` default `DRAFT`
  - changed Question -> ApprovedAnswer relation to optional 1:1 (`approvedAnswer`)
  - expanded `ApprovedAnswer` fields:
    - `answerText`
    - `citationChunkIds` (`String[]`)
    - `source`
    - `approvedBy` (nullable, default `system`)
    - `note` (nullable)
    - `updatedAt` (`@updatedAt`)
  - enforced uniqueness on `ApprovedAnswer.questionId`

### Migration safety

- Added migration `20260224133000_phase1_approval_schema`:
  - preserves existing rows by renaming `ApprovedAnswer.answer` -> `answerText`
  - adds new columns with defaults so old rows remain valid
  - backfills `updatedAt` from `createdAt`
  - applies unique index on `questionId` for 1:1 enforcement

### Tests

- Added `src/lib/approvalSchema.test.ts`:
  - verifies `Question.reviewStatus` defaults to `DRAFT`
  - verifies `ApprovedAnswer` upsert path and unique constraint on `questionId`

## 2026-02-24 - Answer normalization bug trace (no fix yet)

### Scope

- Investigated why a correct grounded draft can become `Not specified in provided documents.` in final output.
- No behavior changes applied.

### String and status locations

- `Not specified in provided documents.`:
  - `src/lib/claimCheck.ts:1`
  - `src/lib/openai.ts:133` (prompt instruction)
  - tests: `src/server/answerEngine.test.ts`
- `Not found in provided documents.`:
  - `src/server/answerEngine.ts:68` (`NOT_FOUND_TEXT`)
  - `src/lib/openai.ts:132,191` (prompt + parser fallback)
  - UI/test references in `src/app/questionnaires/[id]/page.tsx` and tests
- status labels `FOUND | PARTIAL | NOT_FOUND`:
  - currently used as test labels and UI filter label (`NOT_FOUND`) rather than runtime enum state.

### Call graph (end-to-end)

- `POST /api/questions/answer`
  - `src/app/api/questions/answer/route.ts` -> `answerQuestion(...)`
  - `src/server/answerEngine.ts:answerQuestion`
    - `countEmbeddedChunksForOrganization` (`src/lib/retrieval.ts`)
    - `createEmbedding` (`src/lib/openai.ts`)
    - `retrieveTopChunks` (`src/lib/retrieval.ts`)
    - local rerank: lexical overlap + combined score (vector/lexical)
    - `generateEvidenceSufficiency` (`src/lib/openai.ts`)
    - `generateWithFormatEnforcement` (local helper around `generateGroundedAnswer`)
    - citation subset enforcement vs chosen chunks
    - `normalizeAnswerOutput` (local)
      - `applyClaimCheckGuardrails` (`src/lib/claimCheck.ts`)
    - final NOT_FOUND fallback when normalized answer becomes NOT_FOUND
- `POST /api/questionnaires/:id/autofill`
  - `src/app/api/questionnaires/[id]/autofill/route.ts`
  - `processQuestionnaireAutofillBatch` (`src/lib/questionnaireService.ts`)
  - loops questions and calls same `answerQuestion(...)` engine path above

### Root-cause location and trigger

- Overwrite producer:
  - `src/server/answerEngine.ts:320` (`normalizeAnswerOutput`)
  - calls `applyClaimCheckGuardrails` at `src/server/answerEngine.ts:341`
- Rewrite trigger:
  - `src/lib/claimCheck.ts:115-126`
  - if `findUnsupportedKeyTokens(...)` returns any token, answer is forcibly rewritten to `NOT_SPECIFIED_RESPONSE_TEXT`.
- Why this triggers on correct TLS draft:
  - token extraction is lexical (`extractKeyTokens`, `src/lib/claimCheck.ts:74-86`)
  - containment check is literal substring match against quoted snippets (`src/lib/claimCheck.ts:95`)
  - semantically valid paraphrase tokens (for example, `enforced` vs snippet wording `require`) are treated as unsupported and cause rewrite.

### Isolated failing unit test

- Added `src/server/normalizeAnswerOutput.bug.test.ts`
- Repro assertion intentionally checks that normalized output should not be overwritten.
- Current result fails:
  - normalized answer becomes `Not specified in provided documents.` despite grounded draft + non-empty citations.

### Minimal general fix options (planned, not implemented)

- Decouple answer rewriting from review/confidence:
  - keep `needsReview/confidence` downgrades without overwriting semantically grounded answers.
- Gate rewrite only on materially unsupported claims:
  - require stronger mismatch criteria than token-level paraphrase differences.
- Respect sufficiency + citation validity in normalization:
  - avoid template rewrite when sufficiency is true and citations are non-empty/valid, unless a hard safety violation exists.

## 2026-02-25 - phase1-bugfix-01-tests (regression tests only, no code fix)

### Changes

- Confirmed existing repro test is present:
  - `src/server/normalizeAnswerOutput.bug.test.ts`
- Added one positive-control regression test to shared engine suite:
  - `src/server/answerEngine.test.ts`
  - test name: `does not clobber an affirmative grounded answer when sufficiency is true and citations are valid`
- Kept existing NOT_FOUND/PARTIAL contract tests unchanged.

### Test run summary

- Ran:
  - `npx vitest run src/server/normalizeAnswerOutput.bug.test.ts src/server/answerEngine.test.ts`
  - `npm test`
- Current result: both clobber regression tests fail as expected (bug reproduced), existing contract tests remain intact.
- Failing assertions:
  - `src/server/normalizeAnswerOutput.bug.test.ts:29`
  - `src/server/answerEngine.test.ts:209`

## 2026-02-25 - phase1-bugfix-02-fix (normalization clobber guard)

### Root cause

- `normalizeAnswerOutput` accepted claim-check output unconditionally.
- In `applyClaimCheckGuardrails`, token-level mismatch could rewrite a correct affirmative grounded draft to `Not specified in provided documents.`

### Implementation

- Updated `normalizeAnswerOutput` contract in `src/server/answerEngine.ts` to receive sufficiency context:
  - `sufficiencySufficient: boolean`
  - `missingPoints: string[]`
- `answerQuestion` now passes sufficiency outputs into normalization.
- Added template-like detection helpers (case/punctuation tolerant) for:
  - `Not found in provided documents.`
  - `Not specified in provided documents.`
- Added normalization invariant:
  - when sufficiency is true, missingPoints is empty, citations are non-empty/validated, and raw grounded draft is affirmative (not PARTIAL/NOT_FOUND template),
  - if claim-check rewrites to PARTIAL/NOT_FOUND template, preserve the raw grounded draft answer, keep citations, and force `needsReview=true` with `confidence=low`.
- Preserved strict fallbacks:
  - empty citations => strict NOT_FOUND
  - invalid format => strict NOT_FOUND
  - sufficiency false => strict NOT_FOUND (pre-normalization path unchanged)

### Validation

- `npm test` => PASS
- `npm run build` => PASS
