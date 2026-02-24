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

## 5) Active Pages and APIs

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

## 6) Database Notes (Post PR-03/04/05)

- Removed questionnaire run-state/archive persistence fields from `Questionnaire`
- Removed `Question.lastRerunAt`
- Removed `Question.confidence`, `Question.needsReview`, `Question.notFoundReason`
- `ApprovedAnswer` intentionally remains question-bound for now

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
