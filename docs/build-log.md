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

## Day 4 QA hardening v6: relevance gating + format enforcement

### What changed

- Added a deterministic relevance gate before answer generation:
  - extracts question keywords (with security key phrases)
  - scores chunk overlap
  - drops chunks with insufficient overlap
- Added deterministic reranking on filtered chunks:
  - overlap desc, similarity desc, chunkId asc
  - answer generation uses top 3 chunks only
- Added one retry path when citations fail relevance:
  - re-fetches a larger candidate pool
  - excludes already-attempted chunks
  - retries once before returning NOT_FOUND
- Enforced answer-format safety:
  - rejects markdown heading/raw-dump outputs from the model
  - regenerates once with stricter instruction
  - falls back to `Not found in provided documents.` if still invalid
- Fixed hidden regex boundary corruption (`\b`) in backup ask detection.
- Kept deterministic confidence + review behavior aligned with outcome (NOT_FOUND/PARTIAL/FULL).

### Tests added/updated

- Pen-test question with only backup/overview chunks now returns NOT_FOUND (relevance gate blocks irrelevant evidence).
- Backup multi-detail question returns two-part partial answer with confirmed backup facts and explicit missing details.
- Format-enforcement test verifies invalid markdown-style model output is rejected and falls back safely when invalid twice.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run lint`
5. `npm run build`
6. `npm run dev`
7. Open `http://localhost:3000/ask` and verify:
   - pen-test question returns `Not found in provided documents.` when no pen-test evidence exists
   - backup questions produce clean evidence summaries, not raw snippet dumps

## Day 4 QA hardening v7: category routing + must-match retrieval

### What changed

- Added deterministic `categorizeQuestion(question)` routing with fixed categories:
  - `BACKUP_DR`, `SDLC`, `INCIDENT_RESPONSE`, `ACCESS_AUTH`, `ENCRYPTION`, `VENDOR`, `LOGGING`, `RETENTION_DELETION`, `PEN_TEST`, `OTHER`
- Added category-specific retrieval constraints:
  - retrieve vector top-k first
  - apply category must-match keyword filter
  - if no category-matching chunks remain, return exact `Not found in provided documents.`
  - then rerank remaining chunks deterministically (overlap desc, similarity desc, chunkId asc)
- Added category-aware citation preference:
  - backup/DR questions prefer backup/disaster-recovery evidence
  - incident-response questions prefer incident/severity evidence
- Tightened answer-format validation:
  - rejects fragment outputs (`- - ...`) and markdown heading dumps from model output
  - retries once with stricter instruction; falls back to NOT_FOUND if still invalid
  - final normalized answer must be either:
    - exact `Not found in provided documents.`
    - or a `Confirmed from provided documents:` formatted answer
- Tightened confidence behavior:
  - never `high` when `needsReview=true`, when answer contains `Not specified...`, or for category `OTHER`
  - SDLC questions without SDLC must-match evidence now return NOT_FOUND (not partial)

### Tests added/updated

- Category detection test for backup/SDLC/pen-test prompts.
- Backup-vs-IR retrieval test ensuring backup question keeps backup evidence and excludes IR evidence.
- SDLC test with only IR/access chunks ensures must-match filter returns NOT_FOUND and skips generation.
- Fragment-format test ensures invalid `- - ...` model outputs are rejected and fallback to NOT_FOUND.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run lint`
5. `npm run build`
6. `npm run dev`
7. Open `http://localhost:3000/ask` and verify:
   - backup question cites backup/DR evidence
   - SDLC question returns NOT_FOUND unless SDLC evidence exists
   - answers are never raw fragments or heading dumps

## Day 4 QA hardening v8: evidence debug mode and normalized routing

### What changed

- Added normalized matching for routing/filtering:
  - lowercasing
  - unicode dash normalization
  - punctuation stripping (slash/dot preserved)
  - whitespace collapsing
- Applied normalization consistently to:
  - question category detection
  - chunk must-match filtering
  - overlap/relevance term matching
- Tightened must-match logic for key categories:
  - `INCIDENT_RESPONSE`: `incident response` OR (`severity` + `triage|mitigat*`)
  - `BACKUP_DR`: `backup*` OR `disaster recovery` OR `rto` OR `rpo`
  - `ACCESS_AUTH`: `mfa|authentication|sso|saml`
  - `VENDOR`: `subprocessor|vendor`
- Added debug mode for evidence routing:
  - `/api/questions/answer` accepts `debug=true` via query or JSON body
  - questionnaire autofill accepts `debug=true` (query or JSON body)
  - debug payload includes:
    - `category`
    - `threshold`
    - `retrievedTopK`
    - `afterMustMatch`
    - `droppedByMustMatch`
    - `finalCitations`
- Added gated persistence for questionnaire debug:
  - only persisted when `DEBUG_EVIDENCE=true`
  - stored under `Question.sourceRow.__answerDebug`

### Why this matters

This removes routing blind spots that produced false NOT_FOUND for valid IR content and reduces cross-category leakage (for example backups answered from IR text). Debug payloads make future mismatches diagnosable without guessing.

### Tests added/updated

- Unit tests:
  - normalization behavior
  - must-match phrase/group checks (`## Incident Response`, `Backup & Disaster Recovery`)
- Route tests:
  - IR question returns cited result when IR evidence exists
  - backup question prefers backup chunk over IR chunk when both are retrieved
  - debug query wiring for `/api/questions/answer`

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run lint`
5. `npm run build`
6. `npm run dev`
7. Debug check:
   - `POST /api/questions/answer?debug=true`
   - confirm returned debug fields show must-match filtering and final citations

## Day 4 QA hardening v9: /ask debug toggle

### What changed

- Added a `Show debug` checkbox on `/ask`.
- `/ask` now sends `debug: true` in the JSON body when the toggle is checked.
- `/api/questions/answer` already accepted `debug`; this was wired through UI and tests.
- Aligned debug payload shape for easier troubleshooting:
  - `retrievedTopK`: `{ chunkId, docName, similarity, overlap }`
  - `afterMustMatch`: `{ chunkId, docName, similarity, overlap }`
  - `droppedByMustMatch`: `{ chunkId, docName, reason }`
  - `finalCitations`: `{ chunkId, docName }`
- Kept behavior strict: when debug is omitted/false, no `debug` field is returned.

### Why this matters

This makes retrieval/routing failures visible directly from `/ask`, so we can diagnose false negatives or wrong-evidence selection quickly without additional scripts.

### Tests added/updated

- Route test verifies default `debug=false` response excludes `debug`.
- Route test verifies body `debug=true` includes `debug` with `category`.
- Existing safety tests remain passing with the updated routing diagnostics shape.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run dev`
5. Open `http://localhost:3000/ask`
6. Submit once with `Show debug` unchecked and confirm no `debug` field.
7. Submit again with `Show debug` checked and confirm `debug` object is present.

## Day 4 QA hardening v10: snippet section extraction + SDLC broadening

### What changed

- Improved retrieval snippet extraction for headed sections:
  - detects nearest heading (for example `## Backup & Disaster Recovery`, `## Incident Response`)
  - starts snippet at heading (or nearest prior heading to anchor line)
  - includes subsequent lines (up to ~12 lines / 1200 chars)
  - keeps newline boundaries so snippets are not cut mid-word
  - extends backup sections after `Recovery objectives` until RTO/RPO lines are included when available
- Broadened SDLC category evidence matching:
  - SDLC must-match now accepts additional AppSec controls:
    - `dependency scanning`, `sast`, `dast`, `static analysis`, `lint`, `security testing`
    - plus existing SDLC indicators (`code review`, `pr`, `ci`, `ci/cd`, `pipeline`, `branch`, `change management`)
- Improved SDLC answer behavior:
  - if any SDLC must-match evidence exists, SDLC answers return partial two-part output (not false NOT_FOUND)
  - default SDLC asks are now applied for coverage scoring:
    - code review
    - branch protection
    - CI/CD
    - change management
    - dependency/AppSec testing
- Improved BACKUP_DR confirmed-fact extraction:
  - explicitly extracts backup frequency, DR testing cadence, and RTO/RPO patterns from cited snippets

### Tests added/updated

- Retrieval unit test verifies backup section snippets include RPO/RTO lines.
- Answering unit test verifies BACKUP_DR confirmed output includes RTO/RPO from headed backup section text.
- Answering unit test verifies SDLC question with `dependency scanning on every PR` returns partial answer with citations (not NOT_FOUND) and missing SDLC details listed.

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. `npm run lint`
5. `npm run build`
6. `npm run dev`
7. In `/ask`, verify:
   - backup question includes RTO/RPO in `Confirmed from provided documents` when present
   - SDLC question with dependency-scanning evidence returns partial (not NOT_FOUND) with citations

## Day 4 Summary (Final / Approved Candidate)

### What we shipped

- CSV questionnaire import with question-column selection
- Persisted `Questionnaire` + `Question` rows and batch autofill
- CSV export with `Answer`, `Citations`, `Confidence`, `Needs Review`
- Strict evidence-first outcomes:
  - `Not found in provided documents.` when no evidence
  - partial answers with:
    - `Confirmed from provided documents:` (only cited facts)
    - `Not specified in provided documents:` (missing asks)
- Deterministic quality guardrails:
  - claim bounding (no unsupported tokens)
  - formatting enforcement (no raw snippet dumps)
  - relevance gating
  - category routing (`BACKUP_DR`, `SDLC`, etc.) with must-match filters
- `/ask` debug toggle with retrieval diagnostics:
  - category
  - similarity and overlap
  - post-filter chunks
  - dropped reasons

### Prompt pattern used (and why it worked)

We iterated with PR-sized prompts focused on:

- observable failures (paste output -> fix specific failure)
- deterministic guardrails (code rules over prompt-only behavior)
- debug-first diagnosis (retrieval debug output to stop guessing)

This worked well for RAG because model behavior became inspectable and testable.

### Key learning edge

A strong evidence product depends first on:

- retrieval correctness (routing + relevance)
- strict output validation
- debug visibility
- deterministic safety rules

### Day 5 decision handoff

- Keep shared answering logic as the single source of truth
- Add reviewer/approval workflow without weakening evidence guardrails
- Preserve deterministic outcomes and debug observability as features expand

## Day 4 hardening for real questionnaires

### What changed

- Added malformed-character normalization across ingestion/retrieval/answering so corrupted ranges like `30�90` normalize to `30-90`.
- Expanded deterministic routing + must-match categories for real questionnaire failure modes:
  - `RBAC_LEAST_PRIV`
  - `HOSTING`
  - `LOG_RETENTION`
  - `SUBPROCESSORS_VENDOR`
  - `SECRETS`
  - `TENANT_ISOLATION`
  - `PHYSICAL_SECURITY`
  - `SECURITY_CONTACT` (email regex required)
- Tightened must-match handling to support regex-gated categories (security contact now requires email-like evidence).
- Added category-specific fact extraction to prevent irrelevant `Confirmed from provided documents` bullets.
  - secrets/tenant isolation/security contact/physical security/subprocessors now only confirm category-relevant evidence
  - logging facts exclude backup/DR-only lines
  - log retention facts prioritize explicit retention durations
  - hosting extracts provider details and supports partial when region is not specified
  - subprocessors now require assessment/review evidence (not just a vendor list) for confirmation
- Preserved shared answer path behavior for both:
  - `POST /api/questions/answer`
  - questionnaire autofill/rerun-missing flows via `answerQuestionWithEvidence`

### Tests added/updated

- `src/lib/answering.quality.test.ts`
  - MFA admin-access evidence => cited answer (not NOT_FOUND)
  - RBAC/least-privilege evidence => cited answer
  - Hosting provider with missing region => partial answer with missing-region callout
  - Security contact => NOT_FOUND without email; cited answer with email
  - Secrets question without secrets evidence => NOT_FOUND
  - Log retention question => cited answer with normalized `30-90 days`
  - Tenant-isolation question with non-tenant evidence => NOT_FOUND
  - Physical-security question with only generic AWS hosting => NOT_FOUND
  - Subcontractor assessment question without assessment terms => NOT_FOUND
  - Subcontractor assessment with onboarding/monitoring evidence => cited answer
  - Logging question keeps logging facts and excludes backup-only lines
- `src/lib/retrieval.test.ts`
  - Snippet/fullContent normalization for malformed retention ranges (`30�90` -> `30-90`)
- `src/lib/chunker.test.ts`
  - Ingestion normalization for replacement characters

### Verify locally

1. `docker compose up -d`
2. `npx prisma migrate deploy`
3. `npm test`
4. In `/ask` or questionnaire autofill, verify:
   - MFA admin/RBAC/hosting/log retention questions return cited answers when matching evidence exists
   - secrets/tenant isolation/physical security/security contact return exact `Not found in provided documents.` when category evidence is absent
   - log retention output and citations show `30-90` (not malformed replacement character)
