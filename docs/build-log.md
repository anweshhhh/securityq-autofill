# Build Log

This file is a running record of what we build, why we made those choices, and what to decide next.

## How to use this log

- Add new entries at the end of this file (Day 2, Day 3, and so on).
- Keep each entry simple: what changed, prompt pattern used, outcomes, learnings, and next decisions.
- Write entries so they still make sense later without extra context.
- Treat this as the project memory for build decisions and execution quality.

## Day 1 Summary

### What we built today

We bootstrapped a production-style Next.js (TypeScript) app with:

- Dockerized Postgres using pgvector
- Prisma schema with core domain models
- Minimal homepage that renders
- `/api/health` endpoint returning `{ "status": "ok" }`
- One small test validating the health endpoint

This was intentionally scaffolding only, so the repository is runnable but still small and easy to evolve.

### Prompt pattern used

We used a PR-sized prompt pattern with:

- Clear scope boundaries (single small change, no extra features)
- Explicit constraints (stack, files, and architecture choices)
- Acceptance criteria with runnable commands
- Output shaping (exact response format for changed files and run steps)

### Why this prompt was optimized

This prompt style was chosen to reduce ambiguity and prevent scope creep. It pushes toward runnable outcomes by requiring concrete commands and verification steps, rather than broad plans or partially implemented ideas.

### Key learnings and reusable tactics

- Use PR-sized prompts to keep review cycles fast and focused.
- Put acceptance criteria in command form to create objective pass/fail checks.
- Use output shaping to make handoff predictable and easy to review.
- Keep scaffolding thin first, then iterate commit by commit.

### Next decision points (for Day 2)

- Input format support: CSV-only first, or CSV + XLSX from the start
- Document types to support first (for example: SOC 2, SIG, CAIQ, vendor security questionnaires)
- Retrieval and chunking defaults for early document ingestion

## Day 2 Summary

### What we built

We shipped a document ingestion MVP for `.txt` and `.md` files end-to-end:

- `/documents` page with upload + document list (status and chunk count)
- `POST /api/documents/upload` for multipart upload (`file` field)
- `GET /api/documents` for listing ingested documents
- Deterministic chunker with overlap and stable `chunkIndex` starting at `0`
- Default organization bootstrap (create-on-first-use, no auth yet)
- Route and chunker tests, including DB cleanup for test-created rows

### Prompt pattern used (exact structure)

The prompt used this pattern:

- Single PR-sized change request
- Clear product goal reminder (evidence-first is non-negotiable)
- Strict scope for Day 2 only
- Concrete implementation checklist (UI, API, chunker, org handling, tests, docs)
- Acceptance criteria with runnable checks
- Output shaping (changed files, runbook, exact commit message)

### Why this prompt was optimized

This structure reduced ambiguity and kept the change reviewable. It blocked scope creep by naming what not to build, and it forced runnable outcomes by defining concrete pass conditions.

### What to verify locally

1. `docker compose up -d`
2. `npx prisma migrate dev --name day2-document-ingestion` (only if schema changed)
3. `npm test`
4. `npm run dev`
5. Open `http://localhost:3000/documents`
6. Upload a `.txt` or `.md` file and confirm:
   - document status becomes `CHUNKED`
   - chunk rows are created with sequential `chunkIndex`
   - `GET /api/documents` reports the right `chunkCount`

### Next decisions for Day 3

- Embeddings model/provider choice for chunk vectors
- File support expansion order: PDF and DOCX parsing
- Retrieval design for evidence selection and citation formatting

### Day 2 follow-up polish

- Added simple navigation links on the homepage to `/documents`, `/api/health`, and `/api/documents`.
- Added a `Back to Home` link on `/documents` for faster manual testing during development.

## Day 2 Record (Consolidated)

### What shipped

- Document ingestion MVP for `.txt` and `.md`
- Upload + list flow in `/documents`
- `POST /api/documents/upload` and `GET /api/documents`
- Deterministic chunking with stable `chunkIndex` for evidence references
- Default organization creation for no-auth MVP mode
- Tests for chunking and upload route behavior

### Prompt pattern used

- One PR-sized change with explicit constraints and no extras
- Required implementation checklist (UI, API, chunking, storage, tests, docs)
- Acceptance criteria tied to runnable commands and concrete outcomes
- Output shaping (changed files, runbook, exact commit message)

## Day 3 Summary

### What we shipped

- OpenAI embedding integration (`text-embedding-3-small`) for document chunks
- Embedding storage in pgvector `vector(1536)` plus cosine-distance vector index
- Retrieval layer for top-k similar chunks with deterministic ordering (similarity, then `chunkId`)
- `POST /api/questions/answer` endpoint for evidence-grounded single-question answering
- Strict fallback behavior when evidence is insufficient:
  - `answer: "Not found in provided documents."`
  - empty citations
  - `confidence: "low"`
  - `needsReview: true`
- `/ask` UI page to submit one question and render JSON response
- `/api/documents/embed` endpoint to embed all chunks missing embeddings

### Prompt pattern used and why it worked

- Single PR-sized scope with explicit non-goals
- Clear acceptance criteria tied to local verification
- Explicit output schema and exact fallback text
- Test requirements that forced deterministic behavior (mocked OpenAI, ordered retrieval)

This pattern prevented scope drift and kept changes runnable end-to-end while enforcing evidence-first response behavior.

### How to verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. Upload a `.txt` or `.md` file at `http://localhost:3000/documents`
4. Run embeddings: `curl -X POST http://localhost:3000/api/documents/embed`
5. Ask one question at `http://localhost:3000/ask`
6. Confirm response is either:
   - Answer with at least one citation, or
   - `Not found in provided documents.` with empty citations
7. `npm test`

### Day 3 stabilization notes

- Fixed retrieval SQL snippet extraction cast to avoid runtime 500 (`LEFT(content, $4::int)`).
- Hardened upload route so unexpected failures after document creation mark status as `ERROR` instead of leaving `UPLOADED`.
- Added upload tests for `.md` and explicit failure-path coverage.

## Day 4 Summary

### What we shipped

- CSV questionnaire import flow with question-column selection
- `/questionnaires` UI for:
  - CSV upload
  - Questionnaire list
  - Batch autofill trigger
  - CSV export download
- Batch autofill endpoint: `POST /api/questionnaires/:id/autofill`
  - Reuses the same Day 3 evidence-answering logic used by `/api/questions/answer`
  - Persists per-question `answer`, `citations`, `confidence`, and `needsReview`
  - Enforces strict fallback: `Not found in provided documents.` + empty citations + low confidence + needsReview=true
- CSV export endpoint: `GET /api/questionnaires/:id/export`
  - Preserves original columns and row order
  - Appends `Answer`, `Citations`, `Confidence`, `Needs Review`
  - Uses proper CSV escaping and compact citation formatting

### Prompt pattern used and why it worked

- One PR-sized change with explicit scope boundaries
- Hard acceptance criteria for import/autofill/export behavior
- Explicit non-goals to avoid extra features
- Evidence-first output contract carried from Day 3 into batch mode

This kept backend behavior consistent and testable while adding the minimum Day 4 surface area.

### How to verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Open `http://localhost:3000/questionnaires`
6. Upload a CSV and select the question column
7. Click `Autofill`
8. Click `Download CSV` and confirm added columns + citations

## Day 4 (Hardened)

### What changed

- Hardened CSV parsing for BOM, quoted commas/newlines, duplicate headers, and size limits
- Added CSV preview (first rows) + smarter question-column suggestion heuristics
- Stored deterministic export metadata:
  - ordered original headers on questionnaire
  - full original row JSON on each question
  - selected question column key
- Converted autofill into resumable batches:
  - DB-backed run state (`PENDING/RUNNING/COMPLETED/FAILED`)
  - progress counters (`processedCount`, `totalCount`, `foundCount`, `notFoundCount`)
  - `lastError`, `startedAt`, `finishedAt`
  - small per-call batch processing and safe resume
- Added embedding readiness checks before autofill with actionable error messages
- Added rate spacing between model calls to reduce API pressure
- Improved export formatting with compact, truncated citation strings and strict CSV escaping

### Why this pattern worked

- Focused hardening pass (no feature sprawl) let us fix correctness and reliability gaps quickly
- Reusing the shared Day 3 answer service kept single-question and batch behavior aligned
- Deterministic persistence (headers + row JSON + row index) made export reproducible and testable

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Open `http://localhost:3000/questionnaires`
6. Upload a tricky CSV (quoted commas/newlines), verify preview and column selection
7. Click `Autofill/Resume` and watch status/progress move to `COMPLETED`
8. Download CSV and confirm original columns + appended answer/citation fields

## Day 4.x Documents Lifecycle Controls

### What we shipped

- Added `DELETE /api/documents/:id` to remove a document and its chunks
- Enhanced `GET /api/documents` with `displayName`, `updatedAt`, and `errorMessage`
- Added persisted upload failure reasons (`Document.errorMessage`) when status is `ERROR`
- Updated `/documents` with:
  - row delete + bulk delete actions
  - default-on `Show only latest per original filename` toggle to reduce duplicate clutter
  - inline error reason visibility for failed documents

### Why it matters

This removes dead/duplicate entries quickly and makes failures actionable instead of opaque, which improves day-to-day usability and keeps evidence datasets clean.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Open `http://localhost:3000/documents`
6. Upload a valid file and a failing/empty file, confirm ERROR reason is visible
7. Delete single and multiple documents, then refresh to confirm removal

## Day 4.x Questionnaire Details + Hygiene

### What we shipped

- Added questionnaire details API + page:
  - `GET /api/questionnaires/:id`
  - `/questionnaires/[id]` with filters (All, Found, Not Found, Needs Review)
- Added targeted rerun flow:
  - `POST /api/questionnaires/:id/rerun-missing`
  - Processes only unanswered or `Not found in provided documents.` rows
  - Uses the same evidence-grounded answer function as Day 3
  - Runs in resumable batches and updates counts/progress
- Added cleanup actions:
  - `POST /api/questionnaires/:id/archive` (UI default)
  - `DELETE /api/questionnaires/:id` (hard-delete API path)
  - Archived questionnaires are hidden from default list

### Why it matters

Users can now inspect outputs, selectively improve completion after adding evidence, and keep old runs out of the active workspace without losing control of data hygiene.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Open `http://localhost:3000/questionnaires`
6. Create/import questionnaire, run autofill, then click `View` to inspect row-level answers/citations
7. Click `Re-run Missing` after adding evidence and confirm only missing rows are retried
8. Click `Archive` and confirm it disappears from the main list

## Day 4 QA hardening: evidence-bounded answers

### What we shipped

- Hardened the shared answer engine used by both:
  - `POST /api/questions/answer`
  - questionnaire autofill and rerun-missing flows
- Tightened model instructions to be evidence-bounded:
  - only use provided snippets
  - if a detail is not explicit, use `Not specified in provided documents.`
  - no inferred vendors/tools/algorithms
- Added deterministic post-generation claim check:
  - extract key tokens from answer (versions, ALLCAPS, long terms, hyphenated specs, etc.)
  - compare tokens against cited snippets
  - if unsupported tokens appear, rewrite to `Not specified in provided documents.`, set `confidence=low`, `needsReview=true`
- Improved citation snippet quality:
  - larger snippet windows (~520 chars)
  - context-focused substring selection
  - cap citations to 3
- Added tests for:
  - unsupported vendor claim (`AWS`/`KMS`) downgrade
  - partial evidence (`MFA enabled` must not become `MFA required`)
  - route-level safety behavior with mocked LLM/retrieval

### Why it matters

This closes a key trust gap: answers are now constrained to evidence, unsupported specifics are programmatically suppressed, and confidence/needsReview are evidence-driven instead of model-only.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Upload docs and run embeddings (`POST /api/documents/embed`)
6. Ask questions at `http://localhost:3000/ask`
7. Confirm outputs never introduce unsupported vendor/tool/algorithm details

## Day 4 QA hardening v2: citation relevance + coverage scoring

### What changed

- Enforced citation policy in shared answer logic:
  - if final answer is `Not found in provided documents.` or contains `Not specified in provided documents.`, citations are always `[]`
- Added citation relevance filter:
  - extracts key terms from question
  - drops citations if no overlap with cited snippet text
  - forces `needsReview=true`, `confidence=low`
- Improved snippet extraction quality:
  - larger context windows (~700 chars target)
  - sentence-aware anchoring around matched evidence
  - word-boundary clipping to avoid mid-word truncation
- Added deterministic MFA requirement rule:
  - `required` only when evidence explicitly contains `required`/`must`/`enforced` near MFA
  - otherwise returns `MFA is enabled; requirement is not specified in provided documents.`
- Added coverage scoring:
  - detects requested detail intents (e.g., SOC2, SIG, algorithm, scope, keys, retention, frequency, criteria)
  - marks missing intents as partial coverage and forces review-safe confidence handling

### Why it matters

This closes remaining quality gaps where answers looked plausible but overreached evidence, and makes confidence/needsReview behavior deterministic when details are missing.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Ask detail-heavy questions in `/ask` (MFA required, SOC2/SIG, encryption algorithm/scope/keys)
6. Confirm partial answers use `Not specified...`, omit citations, and downgrade confidence/review flags

## Day 4 QA hardening v3: deterministic guardrails

### What changed

- Consolidated all answer safety post-processing into one deterministic function: `normalizeAnswerOutput` in the shared answering module.
- Enforced strict citation rule:
  - if answer is `Not found in provided documents.` or contains `Not specified in provided documents.`, citations are forced to `[]`
  - if citations are `[]`, confidence is forced to `low` and `needsReview` is forced to `true`
- Tightened snippet extraction:
  - sentence/line-aware windows with whitespace-boundary snapping
  - minimum context target so snippets are not clipped into partial words
  - added tests ensuring no trailing partial token fragments
- Hardened MFA-required claim logic:
  - `required` allowed only with explicit evidence (`required`) or `must`/`enforced` near MFA
  - otherwise rewritten to `MFA is enabled; whether it is required is not specified in provided documents.`
- Strengthened coverage scoring:
  - requested-detail tokens (algorithm/cipher/tls/hsts/scope/key/rotation/frequency/retention/rto/rpo/by whom/third-party/soc2/sig/certification)
  - missing requested details force review-safe confidence handling
  - SOC2/SIG gaps in vendor questions are explicitly treated as review-required

### Why it matters

This resolves the remaining observed failures: partial answers cannot carry misleading citations, truncated evidence no longer drives overclaims, and confidence/needsReview now consistently reflect missing requested details.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Test `/ask` with DSR, MFA-required, encryption-detail, and vendor SOC2/SIG questions
6. Confirm partial/not-specified outputs return no citations and force low confidence + review

## Day 4 QA hardening v4: partial evidence outcome

### What changed

- Finalized deterministic answer outcome taxonomy in one shared normalizer:
  - `FOUND`: cited answer with non-empty citations
  - `NOT_FOUND`: exact `Not found in provided documents.` with empty citations
  - `PARTIAL_SPEC`: answer includes `Not specified in provided documents.` and retains citations to partial evidence
- Removed over-blocking behavior that dropped citations for all partial answers.
- Kept hallucination prevention:
  - claim-check still rewrites unsupported specifics and lowers confidence/review status
  - citations are only dropped for true NOT_FOUND or hard relevance failure
- Added relevance retry logic:
  - if first citation set is irrelevant but similarity is strong, retrieval retries once with higher `k`
- Tightened scoring behavior:
  - partial and missing-detail coverage now reliably set review flags
  - confidence is capped when requested details are missing (including SOC2/SIG vendor evidence gaps)

### Tests added/updated

- DB-seeded incident response test verifies a valid FOUND result with citation snippet containing:
  - `incident response`
  - `severity levels`
- Deterministic tests for:
  - pen-test frequency with no evidence => NOT_FOUND + empty citations
  - encryption-at-rest partial evidence => PARTIAL_SPEC + non-empty citations
  - unsupported token claim-check rewrite without dropping valid citations
  - MFA `required` guard against truncated evidence (`requir`)

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Run IR / pen-test / encryption-detail / vendor SOC2+SIG questions in `/ask` and confirm outcome taxonomy behavior

## Day 4 QA hardening v5: two-part answers

### What changed

- Updated shared answering logic to avoid overblocking partial evidence.
- PARTIAL responses now use a deterministic two-part template:
  - `Confirmed from provided documents:` bullet facts extracted from cited snippets
  - `Not specified in provided documents:` bullet list of missing requested details
- NOT_FOUND remains strict:
  - exact `Not found in provided documents.`
  - empty citations
- Added deterministic ask extraction from question patterns (`include`, `specify`, parenthetical asks, frequency, retention, RTO/RPO, by whom, TLS/ciphers/HSTS, scope, keys, algorithm, timelines, SOC2/SIG, etc.).
- Coverage scoring now uses asks list to decide FULL vs PARTIAL and missing detail labels.
- Relevance handling improved:
  - each citation must match question key terms
  - if first pass is irrelevant but similarity is strong, retrieval retries once with higher `k`
  - prefers 1-2 strongest citations to reduce noise

### Why it matters

Users now get actionable partial answers that preserve real evidence instead of losing useful facts behind a blanket `Not specified...` response.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Ask backup/IR/pen-test/vendor-detail questions at `/ask`
6. Confirm partial outputs include both confirmed facts and explicit missing details, with non-empty citations when evidence exists
