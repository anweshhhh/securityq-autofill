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
  - UX polish conventions:
    - contextual feedback uses `message-banner` (`success` / `error`) instead of status badges for user actions
    - list pages support lightweight local search where row volume grows (`/documents`, `/questionnaires`)
    - filtered-table select-all acts on currently visible rows
    - row action hierarchy on `/questionnaires`: keep only core actions inline (`Open`, `Run Autofill`), move export + delete into a compact overflow menu (`More`)
    - Saved Questionnaires search uses a styled control with persistent label and explicit clear action
    - Saved Questionnaires actions are now explicitly visible without requiring horizontal scroll discovery (`Open` + `Run Autofill` on first line, `More` directly below)
    - `/questionnaires/[id]` uses normalized question state (`questionsById` + ordered IDs) and supports `Not found` filter/count alongside review statuses
    - approval actions are server-persisted and reconciled after each mutation (`approve`, `needs review/draft`, `unapprove`, `edit approved`)
    - approved answer is primary when present, with a read-only generated-vs-approved comparison toggle
    - review-velocity layer on `/questionnaires/[id]`:
      - sticky Trust Bar with review status counts + approved progress
      - bulk action rule: `Approve Visible` is scoped to current filter/search and only approves rows with non-NOT_FOUND answers, non-empty citations, and non-approved status
      - keyboard shortcuts with help modal (`?`, `J/K`, `A`, `R`, `U`, `C`, `E`) disabled while typing in form fields
      - loading skeletons shown for rail/main/evidence while questionnaire details are fetching
    - evidence panel conventions:
      - citation chips show `DocName + ...<chunkId last6>` with per-chip `Copy ID` and `Open Doc` actions
      - snippet viewer highlights key question terms client-side and supports `Copy Snippet` + `Copy All Citations`
      - evidence text remains on light surfaces in bounded scroll containers with preserved line breaks
      - no document detail page currently; `Open Doc` uses a read-only modal backed by `GET /api/documents/:id` full-text reconstruction from chunks
    - export UX conventions:
      - export is modal-driven on `/questionnaires` and `/questionnaires/[id]`
      - mode selector options: `Prefer approved` (default), `Approved only`, `Generated only`
      - export requests show in-flight spinner and success/error message banners
      - downloaded filename format: `<questionnaire-name>-<YYYY-MM-DD>-export.csv` (sanitized)
    - question rail and evidence panel on `/questionnaires/[id]` use sticky panels for faster review loops
    - long question/answer/snippet text stays on light surfaces with bounded scroll containers

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

Export UX (client):
- `/questionnaires`: `More -> Export...` opens modal with mode selection
- `/questionnaires/[id]`: `Export` button opens the same modal flow
- Download requests are made against existing export endpoint with `mode` query param
- Client enforces deterministic downloaded filename: `<questionnaire-name>-<YYYY-MM-DD>-export.csv`

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
