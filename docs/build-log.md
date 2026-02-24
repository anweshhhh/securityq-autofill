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
