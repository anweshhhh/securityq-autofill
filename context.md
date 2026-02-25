# Project Context

## 1) Product Summary

Security Questionnaire Autofill focused on **Trust & Consistency**.
Core promise: answers are generated only from uploaded evidence and always include traceable citations.

## 2) MVP Scope (Current)

- Evidence ingestion: upload `.txt`/`.md`, chunk, embed, list, delete
- Answer engine: retrieve + rerank + sufficiency gate + grounded answer with citations
- Questionnaire workflow: CSV import, select question column, single-run autofill, details view, CSV export
- Approval workflow (Phase 1): approve/edit/unapprove overrides per question + review status controls
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

### Answer engine pipeline

Runtime flow in `src/server/answerEngine.ts`:
1) retrieve candidates:
   - `countEmbeddedChunksForOrganization` + `createEmbedding` + `retrieveTopChunks`
2) deterministic rerank:
   - lexical overlap + combined score (`0.7 vector + 0.3 lexical`)
3) sufficiency gate:
   - `generateEvidenceSufficiency` returns `{ sufficient, bestChunkIds, missingPoints }`
4) grounded generation:
   - `generateWithFormatEnforcement` wraps `generateGroundedAnswer`
5) normalization + claim-check:
   - `normalizeAnswerOutput` (input: model answer/confidence/review flags + validated citations + sufficiency result)
   - calls `applyClaimCheckGuardrails` in `src/lib/claimCheck.ts`
   - output: final `{ answer, citations, confidence, needsReview }`

Normalization invariants (claim-check clobber fix):
- Normalization invariant: sufficient+cited drafts cannot be downgraded by claim-check.
- Strict fallbacks remain:
  - empty citations => `Not found in provided documents.`
  - invalid format => `Not found in provided documents.`
  - sufficiency false => `Not found in provided documents.` (handled before normalization)
- Clobber prevention:
  - if sufficiency is true with no missing points, citations are non-empty/validated, raw grounded draft is affirmative (not PARTIAL/NOT_FOUND template), and claim-check rewrites to PARTIAL/NOT_FOUND template,
  - normalization preserves the grounded draft answer, keeps citations, and sets low confidence + needsReview.
- Regression coverage:
  - `src/server/normalizeAnswerOutput.bug.test.ts` (direct normalization repro)
  - `src/server/answerEngine.test.ts` positive-control engine path repro
  - both now pass with the invariant in place.

## 4.1) UI Theme: D-Dark Shell

- Dark shell + light workbench rule:
  - dark chrome for top nav, sidebar, header band, and app frame
  - light canvas for cards, tables, answer bodies, and evidence snippets
- Theme tokens (defined in `src/app/globals.css`):
  - shell/canvas/surfaces: `--bg-shell`, `--bg-canvas`, `--surface`, `--border`
  - typography: `--text`, `--muted-text`
  - brand: `--brand`, `--brand-foreground`
  - status palette:
    - `--status-approved` (green)
    - `--status-review` (amber)
    - `--status-draft` (neutral)
    - `--status-notfound` (red)
- Layout conventions:
  - App shell component: `src/components/AppShell.tsx`
  - desktop sidebar width ~260px, collapsible to ~56px
  - mobile sidebar is a drawer overlay
  - gradients are restricted to chrome/empty-state surfaces (not long-text tables/snippets)
- Component conventions:
  - primitives in `src/components/ui.tsx` (`Button`, `Badge`, `Card`, `TextInput`, `TextArea`)
  - questionnaire details page is a review workbench:
    - left question rail (search + status filters)
    - main answer panel (expand/collapse + actions)
    - right evidence panel (citation chips + snippet viewer + copy actions)

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
- `POST /api/approved-answers`
- `PATCH /api/approved-answers/:id`
- `DELETE /api/approved-answers/:id`
- `POST /api/questions/answer`
- `POST /api/questions/:id/review`
- `GET /api/questionnaires`
- `POST /api/questionnaires/headers`
- `POST /api/questionnaires/import`
- `POST /api/questionnaires/:id/autofill`
- `GET /api/questionnaires/:id`
- `DELETE /api/questionnaires/:id`
- `GET /api/questionnaires/:id/export`

Questionnaire details payload (`GET /api/questionnaires/:id`) now includes per question:
- `reviewStatus`
- `approvedAnswer` (nullable):
  - `id`
  - `answerText`
  - `citationChunkIds`
  - `source`
  - `note`
  - `updatedAt`

Export behavior (`GET /api/questionnaires/:id/export`):
- default mode: `preferApproved` (approved override if present, else generated)
- `mode=approvedOnly`: non-approved rows export blank answer/citations
- `mode=generated`: ignores approved overrides

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
- Questionnaire workflow: import -> autofill -> approval actions -> export modes -> delete
- Approval validation: cross-org citation chunk IDs are rejected
- All OpenAI calls mocked; tests are network-independent
- Active bug regression tests:
  - `src/server/normalizeAnswerOutput.bug.test.ts`
  - `src/server/answerEngine.test.ts` (`does not clobber an affirmative grounded answer...`)

## 10) Next Focus

- Evolve `ApprovedAnswer` beyond strict `questionId` binding to reusable, evidence-validated approvals.
- Add approval evidence revalidation when source evidence changes.

## 11) Phase 1: Approval workflow schema + API/UI

Schema (already implemented):
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

API/UI (implemented):
- Approval routes:
  - `POST /api/approved-answers`
  - `PATCH /api/approved-answers/:id`
  - `DELETE /api/approved-answers/:id`
  - `POST /api/questions/:id/review` (`NEEDS_REVIEW` / `DRAFT`)
- UI in `/questionnaires/[id]`:
  - status badge (`Draft` / `Approved` / `Needs review`)
  - Approve current generated answer
  - Edit approved answer + citation chunk IDs
  - Mark needs review / mark draft
  - Unapprove
  - filters: All / Draft / Approved / Needs review
- Export preference modes wired to UI links on `/questionnaires` list page.

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
