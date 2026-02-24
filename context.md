# Project Context

## 1) Product Summary

Security Questionnaire Autofill + Evidence Finder for B2B SaaS sales workflows.  
Core promise: generate answers grounded in uploaded evidence, with explicit citations.

## 2) Target Users

- Seed to Series B B2B SaaS teams doing enterprise sales
- Focus: teams responding to security questionnaires during vendor due diligence
- Out of scope right now: healthcare, fintech, and government-heavy workflows

## 3) Non-Negotiables

- Evidence-first: every generated answer must include at least one citation, or explicitly say `Not found in provided documents.`
- Delivery discipline: PR-sized changes with tests, acceptance criteria, and clear commit messages
- MVP-first: keep implementation minimal before adding advanced capabilities

## 4) Current Implemented Features (Day 1-4)

- Next.js App Router scaffold (TypeScript) with `src/` layout
- Docker Postgres with pgvector enabled
- Prisma models: `Organization`, `Document`, `DocumentChunk`, `ApprovedAnswer`, `Questionnaire`, `Question`
- `/api/health` endpoint
- Documents ingestion for `.txt` and `.md`: upload, extract text, chunk, store, list
- `/documents` UI for upload, list, latest-only filtering, and delete controls (single + bulk)
- Document lifecycle clarity: `errorMessage` persisted on failed uploads and shown in UI
- Embeddings pipeline with OpenAI `text-embedding-3-small` and pgvector `vector(1536)` storage
- Retrieval + cited single-question answering at `/api/questions/answer`
- Evidence-bounded answer guardrails:
  - outcome taxonomy is deterministic:
    - FOUND => cited answer with non-empty citations
    - NOT_FOUND => exact `Not found in provided documents.` and empty citations
    - PARTIAL => `Not specified in provided documents.` when evidence is incomplete/unsupported (with citations retained when evidence exists)
  - domain-agnostic retrieval and reranking:
    - retrieve vector top-k chunks (`topK=12`)
    - compute generic lexical overlap between question and chunk text
    - combined score is deterministic (`0.7 * vector + 0.3 * lexical`)
    - answer context uses reranked top-n chunks (`topN=5`)
  - domain-agnostic evidence sufficiency gate:
    - LLM returns `{ sufficient, bestChunkIds, missingPoints }`
    - if `sufficient=false`, result is strict NOT_FOUND
  - generic answer generation:
    - LLM answers only from selected snippets and returns citations by `chunkId`
    - cited chunk IDs are validated against selected retrieval set
  - deterministic safety checks:
    - if citations are empty, force NOT_FOUND
    - claim-check rewrites unsupported specifics to `Not specified in provided documents.`
    - invalid output formats (headings/raw snippet dumps/fenced blocks) are rejected with one strict retry
  - debug mode is available for `/api/questions/answer` and questionnaire autofill (`debug=true`) with retrieval-stage visibility:
    - threshold, retrievedTopK (vector), rerankedTopN (combined), chosenChunks, sufficiency result, finalCitations
  - questionnaire debug persistence is gated by `DEBUG_EVIDENCE=true` to avoid JSON bloat by default
  - deterministic `notFoundReason` labeling for NOT_FOUND:
    - `NO_RELEVANT_EVIDENCE` (insufficient explicit evidence for the question)
    - `RETRIEVAL_BELOW_THRESHOLD` (top similarity below threshold)
    - `FILTERED_AS_IRRELEVANT` (retrieved evidence exists but no valid cited answer survives safety checks)
  - deterministic `normalizeAnswerOutput` post-processor is the single source of truth for all answer guardrails
  - confidence/needsReview are deterministic:
    - NOT_FOUND => low confidence, needsReview true
    - unsupported claims or format-retry paths force needsReview and cap confidence
- `/ask` UI for one-question evidence-grounded responses, with a `Show debug` toggle that sends `debug: true` and renders retrieval diagnostics
- Questionnaire CSV import + question-column selection + batch autofill + CSV export
- `/questionnaires` UI for import, preview, autofill/resume, rerun-missing, archive, and export actions
- Questionnaire details page at `/questionnaires/[id]` with per-question answers/citations filters, `NotFoundReason`, and a Missing Evidence Report grouped by category
- Resumable autofill run state on `Questionnaire` (`PENDING/RUNNING/COMPLETED/FAILED`) with progress counters
- Homepage shortcuts: `Go to Documents`, `Go to Questionnaires`, `Go to Ask`, `Open API Health`, `Open API Documents`

## 5) Current Endpoints and Pages

Pages:
- `/` (home)
- `/documents` (upload + list)
- `/questionnaires` (CSV import + autofill + export)
- `/questionnaires/[id]` (result details + filters)
- `/ask` (single-question answering)

API:
- `GET /api/health`
- `GET /api/documents`
- `DELETE /api/documents/:id`
- `POST /api/documents/upload`
- `POST /api/documents/embed`
- `POST /api/questions/answer`
- `GET /api/questionnaires`
- `POST /api/questionnaires/headers`
- `POST /api/questionnaires/import`
- `POST /api/questionnaires/:id/autofill`
- `POST /api/questionnaires/:id/rerun-missing`
- `POST /api/questionnaires/:id/archive`
- `GET /api/questionnaires/:id`
- `DELETE /api/questionnaires/:id`
- `GET /api/questionnaires/:id/export`

## 6) Local Runbook

```bash
docker compose up -d
npx prisma migrate deploy
npm test
npm run dev
```

Then open:
- `http://localhost:3000/`
- `http://localhost:3000/documents`
- `http://localhost:3000/questionnaires`
- `http://localhost:3000/ask`

## 7) Environment Variables

Use `.env.example` as the source of truth for required environment variables.  
Current required variables:
- `DATABASE_URL` (Postgres connection)
- `OPENAI_API_KEY` (OpenAI embeddings + chat calls)
- `DEBUG_EVIDENCE` (optional; set `true` to persist questionnaire autofill debug objects in `Question.sourceRow.__answerDebug`)

## 8) How We Work

- Use copy/pasteable prompts to Codex with explicit scope, constraints, acceptance criteria, and output format
- Review UI quickly, but assume backend correctness and data integrity need extra care
- Avoid extras not requested in the prompt; prefer small, reviewable increments
- Keep each change easy to verify locally
- Prefer resumable operations and DB-backed progress for long-running tasks
- Keep answer quality deterministic: strict prompt constraints plus post-generation claim checks

## 9) Next Milestones

- Day 5: evidence-aware answer approval workflow and reviewer UX
- Day 6: XLSX support + larger questionnaire performance improvements

## 10) Day 5 New-Chat Bootstrap Prompt

Use this in a new Codex chat to restore full working context quickly:

```text
Use /Users/anweshsingh/Downloads/Attestly/securityq-autofill/context.md and /Users/anweshsingh/Downloads/Attestly/securityq-autofill/docs/build-log.md as source of truth, then implement Day 5 as one PR-sized change.

Non-negotiables:
- Evidence-first remains strict:
  - FOUND => cited answer
  - PARTIAL => confirmed + not specified with citations
  - NOT_FOUND => exact "Not found in provided documents."
- Reuse shared answer logic; do not fork behavior between /api/questions/answer and questionnaire autofill.
- Keep deterministic guardrails, tests, and debugability.

Before coding:
1) Summarize current architecture in 8-12 bullets from those docs.
2) List acceptance criteria as runnable checks.
3) Then implement only Day 5 scope.
```
