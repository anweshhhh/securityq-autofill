# Project Context

## 1) Product Summary

Security Questionnaire Autofill focused on **Trust & Consistency**.
Core promise: answers are generated only from uploaded evidence and always include traceable citations.

## 2) MVP Scope (Current)

- Evidence ingestion: upload `.txt`/`.md`/`.pdf`, chunk, embed, list, delete
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

### Ingestion formats + extraction notes

- Supported upload formats: `.txt`, `.md`, `.pdf`
- Text/Markdown extraction: direct file text read
- PDF extraction: `pdf-parse` (Node-side, lazy-loaded from `pdf-parse/lib/pdf-parse.js`) with per-page separators inserted as:
  - `--- Page N ---`
- Chunking rules are unchanged and deterministic (`src/lib/chunker.ts`).
- Citations continue to reference persisted `DocumentChunk.id` values only.
- Upload route runtime is explicitly Node (`/api/documents/upload`).
- Upload API error contract is JSON-only:
  - `{ error: { message: string, code: string } }`
  - client upload flow checks response `content-type` before JSON parsing and surfaces non-JSON payload snippets for debugging.
- Autofill UI flow now runs embeddings automatically before questionnaire autofill:
  - `/questionnaires` and `/questionnaires/[id]` call `POST /api/documents/embed` before `POST /api/questionnaires/:id/autofill`.

### PDF ingestion coverage diagnostics

- Latest PDF diagnostic target: `template_evidence_pack.pdf` (`docId: cmm2usn6a000yffie77116mp5`).
- Coverage snapshot:
  - chunks: `3`
  - embeddings present: `3/3`
  - missing embeddings: `0`
- Phrase-level chunk search confirms expected control statements are present in stored chunk text (`least privilege`, access review cadence, `TLS 1.2+`, `mTLS`, `AES-256`, `KMS`, `PCI DSS not applicable`).
- DEV debug for failing-style questions shows:
  - relevant chunks are retrieved/reranked (`topK`/`topN` include the expected chunk IDs),
  - but sufficiency gate can still return `sufficient=false`, causing strict NOT_FOUND.
- Current diagnosis: PDF-only misses are primarily a **sufficiency-gate classification issue**, not extraction/chunking/embedding coverage.

### Answer engine pipeline

Runtime flow in `src/server/answerEngine.ts`:
1) retrieve candidates:
   - `countEmbeddedChunksForOrganization` + `createEmbedding` + `retrieveTopChunks`
2) deterministic rerank:
   - lexical overlap + combined score (`0.7 vector + 0.3 lexical`)
3) extractor gate:
   - `generateEvidenceSufficiency` now returns extractor JSON:
     - `requirements`
     - `extracted[]` (`requirement`, `value|null`, `supportingChunkIds[]`)
     - `overall` (`FOUND | PARTIAL | NOT_FOUND`)
   - gate decision is deterministic in code:
     - `overall=NOT_FOUND` OR all values null => strict NOT_FOUND
     - some values present but requirements not fully satisfied => PARTIAL
     - all requirements satisfied => FOUND
4) answer composition:
   - FOUND answers are composed from extracted requirement/value pairs.
   - PARTIAL answers return exact `Not specified in provided documents.` with citations.
   - citations are sourced from extractor `supportingChunkIds` and must map to selected reranked chunk IDs.
5) normalization + claim-check:
   - `normalizeAnswerOutput` (input: composed answer + validated citations + extractor decision)
   - calls `applyClaimCheckGuardrails` in `src/lib/claimCheck.ts`
   - output: final `{ answer, citations, confidence, needsReview }`

Normalization invariants (claim-check clobber fix):
- Normalization invariant: extractor FOUND + fully satisfied + cited drafts cannot be downgraded by claim-check.
- Strict fallbacks remain:
  - empty citations => `Not found in provided documents.`
  - invalid format => `Not found in provided documents.`
  - extractor NOT_FOUND/all-null => `Not found in provided documents.` (handled before normalization)
- Clobber prevention:
  - if extractor outcome is FOUND with fully satisfied requirements, citations are non-empty/validated, raw draft is affirmative (not PARTIAL/NOT_FOUND template), and claim-check rewrites to PARTIAL/NOT_FOUND template,
  - normalization preserves the grounded draft answer, keeps citations, and sets low confidence + needsReview.
- Regression coverage:
  - `src/server/normalizeAnswerOutput.bug.test.ts` (direct normalization repro)
  - `src/server/answerEngine.test.ts` positive-control engine path repro
  - `src/server/answerEngine.pdfGate.regression.test.ts` (PDF extractor-gate coverage)
  - all pass with the extractor gate in place.

### Extractor gate failure modes (diagnosed)

Diagnostic harness:
- `src/server/answerEngine.diagnose-all-notfound.test.ts`
- run with:
  - `RUN_EXTRACTOR_DIAGNOSE=true npm test -- src/server/answerEngine.diagnose-all-notfound.test.ts`
  - latest captured output: `artifacts/diagnose/extractor-gate-all-notfound-2026-02-26.txt`

Observed failure mode for global NOT_FOUND:
- Retrieval/rerank is healthy (`topK`/`topN` include relevant chunks).
- Extractor gate path is actually executed (`generateEvidenceSufficiency` is called).
- Raw extractor response is JSON, but output shape can drift from contract:
  - `extracted` returned as object/map instead of array of `{ requirement, value, supportingChunkIds }`
  - `supportingChunkIds` returned top-level or nested incorrectly instead of per extracted item
  - `requirements` returned as object/map instead of string array
- Root cause before mitigation was strict parser behavior:
  - non-array `requirements` or `extracted` collapsed to empty arrays
  - this forced normalized `overall=NOT_FOUND` and strict NOT_FOUND output in engine.

Primary root-cause category:
- extractor called + JSON parse success, but **schema mismatch between raw extractor output and expected contract** causes deterministic NOT_FOUND collapse.

### Extractor output normalization rules

Current mitigation in `src/lib/openai.ts` (`normalizeExtractorOutput`):
- requirements normalization:
  - array -> keep string items
  - string -> single-item array
  - object/map -> derive strings from values, then keys, then nested string leaves
- extracted normalization:
  - array form accepted (`{ requirement, value|extractedValue, supportingChunkIds|chunkIds|chunks }`)
  - map form accepted (`requirement -> value` or `requirement -> { value|extractedValue, supportingChunkIds|chunkIds|chunks }`)
- supporting chunk IDs:
  - accepted aliases: `supportingChunkIds`, `chunkIds`, `chunks`
  - top-level requirement-keyed maps are supported when per-item chunk IDs are missing
  - top-level flat chunk ID arrays are **not** blindly applied to every extracted requirement
  - all chunk IDs are always filtered to reranked allowed chunk IDs (invalid IDs dropped)
- deterministic gate outcome after normalization:
  - at least one valid extracted item (`value` + valid supporting chunk IDs) is required for non-NOT_FOUND
  - otherwise output is `NOT_FOUND` and marked `extractorInvalid=true`
- engine fallback:
  - when extractor output is marked invalid and reranked context exists, extractor path falls back to grounded draft generation using the same reranked topN context.
  - fallback acceptance invariant:
    - accept only if grounded answer is non-empty and citations remain non-empty after allowed-chunk validation.
    - accepted fallback responses are forced to `needsReview=true` and `confidence="low"`.
    - if fallback answer/citations are invalid, return strict `Not found in provided documents.`.
  - this prevents schema-mismatch-driven global NOT_FOUND while preserving evidence-first constraints.

### Extractor prompt schema

Extractor prompt in `generateEvidenceSufficiency` (`src/lib/openai.ts`) now explicitly enforces:
- JSON-only output (no prose/markdown/code fences).
- exact top-level keys:
  - `requirements`
  - `extracted`
  - `overall`
- strict types:
  - `requirements: string[]`
  - `extracted: Array<{ requirement: string, value: string | null, supportingChunkIds: string[] }>`
  - `overall: "FOUND" | "PARTIAL" | "NOT_FOUND"`
- explicit prohibition:
  - `Do NOT use objects/maps for requirements or extracted. Use arrays only.`
- citation ID safety:
  - `supportingChunkIds` must be selected only from provided `allowedChunkIds`.
- prompt input includes compact allowed ID set as:
  - `allowedChunkIds (CSV): id1,id2,...`
- prompt includes a minimal generic JSON example to reduce schema drift.

### PDF/TXT parity regression coverage

- Added deterministic parity regression:
  - `src/app/api/questionnaires/pdfTxt.parity.regression.test.ts`
- Added stable fixtures:
  - `test/fixtures/template_evidence_pack.pdf` (selectable text)
  - `test/fixtures/template_evidence_pack.txt` (same evidence content)
  - `test/fixtures/template_questionnaire.csv`
- Parity test contract (OpenAI fully mocked, no network):
  - upload PDF -> embed -> autofill (31-question fixture) and assert:
    - `foundCount >= 30`
    - strict ISO 27001 NOT_FOUND (`Not found in provided documents.` with empty citations)
  - upload TXT -> embed -> autofill and assert same outcome
  - for key controls, assert FOUND + citations in both modes:
    - MFA
    - TLS minimum version
    - AES-256 + KMS
    - RPO/RTO
    - SOC 2 Type II + Trust Services Criteria
- Added chunk boundary regression coverage:
  - `src/lib/chunker.test.ts` asserts critical tokens remain intact in at least one chunk:
    - `AES-256`
    - `KMS-managed`
    - `TLS 1.2+`
- Test isolation detail:
  - parity suite mocks `getOrCreateDefaultOrganization` to a dedicated test org to prevent cross-suite embedding-availability collisions.

### ApprovedAnswer reuse across questionnaires

- Added reusable approval metadata on `ApprovedAnswer`:
  - `normalizedQuestionText`
  - `questionTextHash` (MD5 of normalized text)
  - `questionEmbedding` (`vector(1536)`)
- Approval create/update routes now persist question metadata and embedding:
  - `POST /api/approved-answers`
  - `PATCH /api/approved-answers/:id`
- Autofill now attempts approval reuse before calling the answer engine:
  - exact match first (`questionTextHash` / `normalizedQuestionText`)
  - near-exact text match next (high-threshold normalized similarity)
  - semantic match last (embedding cosine similarity threshold)
- Reuse safety invariants:
  - reused `citationChunkIds` must still resolve to existing chunks owned by the same organization
  - if any cited chunk is missing/out-of-org, candidate reuse is rejected
  - reused answers always return with citations and `needsReview=false`
- Autofill result now includes reuse metadata for downstream UI:
  - `reusedCount`
  - `reusedFromApprovedAnswers[]` with `{ questionId, rowIndex, reusedFromApprovedAnswerId, matchType }`
- Question-level reuse metadata is now persisted on `Question` during autofill:
  - `reusedFromApprovedAnswerId`
  - `reuseMatchType` (`EXACT | SEMANTIC`)
  - `reusedAt`
- Reuse does not auto-approve:
  - reused answers keep normal review flow (no automatic `reviewStatus=APPROVED`)
- Bulk trust action for exact reused rows:
  - `POST /api/questionnaires/:id/approve-reused` with `{ mode: "exactOnly" }`
  - approves only rows with `reuseMatchType=EXACT`
  - requires non-NOT_FOUND answer and non-empty citations
  - citations must still exist and belong to the same organization
  - semantic reused rows and strict NOT_FOUND rows are never approved by this bulk action

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
- Accessibility rules:
  - dark-shell navigation text and active states are tuned for WCAG AA contrast
  - status color semantics remain fixed:
    - approved = green
    - needs review = amber
    - draft = neutral
    - not found = red
  - interactive controls require visible focus styles and accessible labels
  - modal/drawer surfaces trap keyboard focus while open and support `Esc` close
  - landmarks + progressbar a11y:
    - shell includes explicit landmarks (`header`, `nav`, single `main`, sidebar navigation landmark)
    - focusable skip link (`Skip to main content`) targets `#main-content`
    - Trust Bar progress indicator has an accessible name and value text (`aria-label`/`aria-labelledby` + `aria-valuetext`)
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
      - `Run Autofill` uses live progress UI in-button (`answered/total`) and polls questionnaire details during active runs so rail/answer/evidence refresh incrementally
    - evidence panel conventions:
      - citation chips show doc name only (ellipsized) with compact per-row actions (`Copy reference`, `Open document`)
      - snippet viewer highlights key question terms client-side and supports compact toolbar copy actions (`Copy citation IDs`, `Copy selected snippet`, optional evidence pack copy)
      - evidence text remains on light surfaces in bounded scroll containers with preserved line breaks
      - per-citation row layout is two-zone (`chip label` + `compact action icons`) to avoid text-button clipping in narrow side panels
      - per-citation action controls are compact icon buttons with tooltip titles and explicit `aria-label`s
      - chip label now prioritizes doc name only (ellipsized); chunk IDs are hidden from primary chip text
      - citation IDs remain available for auditability via tooltip and copy-reference actions (`DocName#ChunkId`)
      - evidence toolbar is compact (`Evidence (N)` + always-visible `Copy refs` + icon-only secondary actions), reducing vertical whitespace in the right panel
      - row actions visibility: desktop reveals on row hover/focus and selected row; mobile keeps row actions always visible
      - header icon tooltips use below-placement near panel top to avoid clipping (`Copy selected snippet`, `Copy evidence pack`)
      - no document detail page currently; `Open Doc` uses a read-only modal backed by `GET /api/documents/:id` full-text reconstruction from chunks
    - export UX conventions:
      - export is modal-driven on `/questionnaires` and `/questionnaires/[id]`
      - mode selector options: `Prefer approved` (default), `Approved only`, `Generated only`
      - export requests show in-flight spinner and success/error message banners
      - downloaded filename format: `<questionnaire-name>-<YYYY-MM-DD>-export.csv` (sanitized)
    - performance guardrails:
      - question rail uses deferred search + memoized preview rows for larger questionnaires
      - rail renders preview text only; full answer/evidence rendering stays scoped to selected question panel
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

### Feature flags

- `DEV_MODE` (optional, default `false`)
- `DEBUG_EVIDENCE` (optional; effective only when `DEV_MODE=true`)
- `EXTRACTOR_GATE` (optional rollout toggle for answer gate mode):
  - truthy (`true/1/yes/on`) => extractor gate path
  - falsy (`false/0/no/off`) => legacy sufficiency gate path
  - unset default: `true` in `NODE_ENV=development` and `NODE_ENV=test`, `false` otherwise

## 9) Tests (MVP Contracts)

- Ingestion: upload/chunk/embed path
- Answer engine: FOUND / NOT_FOUND / PARTIAL behavior and citation guardrails
- Questionnaire workflow: import -> autofill -> approval actions -> export modes -> delete
- Approval validation: cross-org citation chunk IDs are rejected
- All OpenAI calls mocked; tests are network-independent
- Active bug regression tests:
  - `src/server/normalizeAnswerOutput.bug.test.ts`
  - `src/server/answerEngine.test.ts` (`does not clobber an affirmative grounded answer...`)
  - `src/server/answerEngine.pdfGate.regression.test.ts` (PDF extractor-gate regression coverage)
  - `src/app/api/questionnaires/pdfOnly.autofill.regression.test.ts` (PDF-only upload->embed->import->autofill end-to-end regression)
  - fixture used: `test/fixtures/evidence-gate.pdf`
  - fixture used: `test/fixtures/template_evidence_pack.pdf`

## 9.1) UI Audit Tooling

- Added questionnaire UI audit automation:
  - script: `scripts/ui_audit_questionnaire.js`
  - command: `npm run ui:audit -- <url>`
  - default URL when omitted: `http://localhost:3000/questionnaires`
- Audit output directory per run:
  - `artifacts/ui-audit/<timestamp>/`
- Each run produces:
  - screenshots: desktop (`1440x900`), tablet (`834x1112`), mobile (`390x844`)
  - `console-errors-warnings.json`
  - `network-failures.json`
  - `dom-assertions.json`
  - `axe-summary.json` and `axe-results.json`
  - `summary.json` and `report.txt`
- Stable selectors for assertions are provided via minimal `data-testid` attributes:
  - `app-sidebar-nav` / `app-sidebar-nav-mobile`
  - `question-rail-panel`
  - `answer-main-panel`
  - `evidence-panel`

## 10) Next Focus

- Evolve `ApprovedAnswer` beyond strict `questionId` binding to reusable, evidence-validated approvals.
- Add approval evidence revalidation when source evidence changes.
