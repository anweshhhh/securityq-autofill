# Project Context

## 1) Product Summary

Security Questionnaire Autofill focused on **Trust & Consistency**.
Core promise: answers are generated only from uploaded evidence and always include traceable citations.

## 2) MVP Scope (Current)

- Evidence ingestion: upload `.txt`/`.md`, chunk, embed, list, delete
- Answer engine: retrieve + rerank + sufficiency gate + grounded answer with citations
- Questionnaire workflow: CSV import, select question column, single-run autofill, details view, CSV export
- Approval workflow baseline: `ApprovedAnswer` model retained for next iteration
- Debug tooling: allowed only behind `DEV_MODE=true` (and persistence also requires `DEBUG_EVIDENCE=true`)

## 3) Non-Negotiables

- FOUND answers require non-empty citations
- NOT_FOUND response is exact: `Not found in provided documents.` with empty citations
- PARTIAL response is exact: `Not specified in provided documents.` when relevant evidence exists but specifics are missing
- No doc-template-specific keyword/canned-answer logic in retrieval/answer path

## 4) Current Architecture

- Stack: Next.js App Router + TypeScript + Prisma + Postgres (`pgvector`)
- Core Prisma models: `Organization`, `Document`, `DocumentChunk`, `Questionnaire`, `Question`, `ApprovedAnswer`
- Shared answering pipeline in `src/server/answerEngine.ts` used by:
  - `POST /api/questions/answer`
  - `POST /api/questionnaires/:id/autofill`
- Deterministic retrieval flow:
  - vector topK=12
  - lexical overlap scoring
  - combined score: `0.7 * vector + 0.3 * lexical`
  - selected context topN=5
- One strict output-format retry for LLM answer generation

## 5) API Surface

Pages:
- `/`
- `/documents`
- `/questionnaires`
- `/questionnaires/[id]`
- `/ask` (DEV_MODE-gated)

API:
- `GET /api/documents`
- `DELETE /api/documents/:id`
- `POST /api/documents/upload`
- `POST /api/documents/embed`
- `POST /api/questions/answer`
- `GET /api/questionnaires`
- `POST /api/questionnaires/headers`
- `POST /api/questionnaires/import`
- `POST /api/questionnaires/:id/autofill`
- `GET /api/questionnaires/:id`
- `DELETE /api/questionnaires/:id`
- `GET /api/questionnaires/:id/export`

Phase 1 planned API additions (not implemented yet):
- `PUT /api/questionnaires/:id/questions/:questionId/approval`
- `DELETE /api/questionnaires/:id/questions/:questionId/approval`
- `GET /api/questionnaires/:id` response extension with `approvedAnswer` per question

## 6) Database schema state

- Core models: `Organization`, `Document`, `DocumentChunk`, `Questionnaire`, `Question`, `ApprovedAnswer`
- Prior cleanup retained:
  - removed questionnaire run-state/archive persistence fields from `Questionnaire`
  - removed `Question.lastRerunAt`
  - removed `Question.confidence`, `Question.needsReview`, `Question.notFoundReason`
- Phase 1 schema additions:
  - `Question.reviewStatus` enum defaulting to `DRAFT`
  - `ApprovedAnswer` expanded for explicit approved overrides:
    - `answerText`
    - `citationChunkIds` (`String[]`)
    - `source` (`GENERATED | MANUAL_EDIT`)
    - `approvedBy` (nullable, default `"system"`)
    - `note` (nullable)
    - `updatedAt` (`@updatedAt`)
  - enforced 1:1 `ApprovedAnswer.questionId` via unique constraint
- `ApprovedAnswer` is still question-bound for now (reuse beyond question-binding remains a later milestone)

## 7) Local Runbook

```bash
docker compose up -d
npx prisma migrate deploy
npm test
npm run dev
```

## 8) Environment Variables

Use `.env.example` as source of truth.

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `DEV_MODE` (optional, default false)
- `DEBUG_EVIDENCE` (optional; effective only when `DEV_MODE=true`)

## 9) Tests (MVP Contracts)

- Ingestion: upload/chunk/embed path
- Answer engine: FOUND / NOT_FOUND / PARTIAL behavior and citation guardrails
- Questionnaire workflow: import -> autofill -> export -> delete
- All OpenAI calls mocked; tests are network-independent

## 10) Next Focus

- Evolve `ApprovedAnswer` from strict `questionId` binding to reusable, evidence-validated approvals.

## 11) Phase 1: Approval workflow schema

Implemented in schema/migration:
- `Question.reviewStatus` with enum values:
  - `DRAFT`
  - `NEEDS_REVIEW`
  - `APPROVED`
- `ApprovedAnswer` now models approved override payload (not generic review state):
  - one row per question (`questionId` unique)
  - answer body in `answerText`
  - citations in `citationChunkIds`
  - provenance in `source`
  - reviewer metadata via `approvedBy` and `note`
  - lifecycle timestamps `createdAt` + `updatedAt`

Still pending (Phase 1 API/UI implementation):
- Approval API routes for approve/unapprove/edit/reject actions
- `/questionnaires/[id]` approval controls + filters
- Export selection mode to prefer approved overrides by default

## 12) New Chat Handoff Template

Use this template whenever we move to a new chat. Keep it short and current.

```text
Use /Users/anweshsingh/Downloads/Attestly/securityq-autofill/context.md and /Users/anweshsingh/Downloads/Attestly/securityq-autofill/docs/build-log.md as source of truth.

Handoff snapshot:
- Branch: <branch-name>
- Latest commit: <commit-sha>
- Baseline tag: <tag-or-none>
- Current MVP surface:
  - Pages: /, /documents, /questionnaires, /questionnaires/[id], /ask (DEV only)
  - APIs: documents upload/embed/list/delete, questions/answer, questionnaires headers/import/list/:id/autofill/export/delete
- Last completed PR/task: <short-description>
- Next task to implement: <exact-scope>

Constraints:
- Keep changes PR-sized.
- Do not add non-MVP features unless explicitly requested.
- Preserve evidence-first guardrails:
  - FOUND requires citations
  - NOT_FOUND => exact \"Not found in provided documents.\"
  - PARTIAL => \"Not specified in provided documents.\" only when relevant but incomplete
- Keep debug hidden unless DEV_MODE=true.

Before coding:
1) Summarize current state in 6-10 bullets from context.md/build-log.md.
2) List acceptance checks as runnable commands.
3) Implement only the requested scope.
```
