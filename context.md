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
    - PARTIAL_SPEC => two-part answer:
      - `Confirmed from provided documents:` facts list
      - `Not specified in provided documents:` missing details list
      and keeps citations to partial evidence
  - if snippets are insufficient for requested details, partial answers list missing details explicitly instead of collapsing the full response
  - deterministic claim-check downgrades unsupported claims to low confidence + needsReview
  - vendors/tools/algorithms are blocked unless terms appear in cited snippets
  - deterministic relevance gate filters retrieved chunks by keyword overlap before answer generation
  - deterministic question category routing (`BACKUP_DR`, `SDLC`, `INCIDENT_RESPONSE`, `ACCESS_AUTH`, `ENCRYPTION`, `VENDOR`, `LOGGING`, `RETENTION_DELETION`, `PEN_TEST`, `OTHER`)
  - category-specific must-match retrieval filters run before reranking; if no category-relevant chunks remain, result is `Not found in provided documents.`
  - reranking is deterministic: overlap desc, similarity desc, chunkId asc; top 3 chunks are used for answering
  - if relevance-filtered citations are empty, retrieval retries once with a larger pool and different chunks before returning NOT_FOUND
  - citation selection is category-aware (e.g., backup/DR and incident-response snippets are preferred when available)
  - invalid model output format (markdown headings/raw evidence dumps) is rejected; one strict regeneration is attempted, then it falls back to NOT_FOUND
  - citation relevance filter keeps only snippets with question-term overlap and retries retrieval once with larger top-k if needed
  - deterministic `normalizeAnswerOutput` post-processor is the single source of truth for all answer guardrails
  - coverage scoring marks missing requested details (SOC2/SIG/algorithm/scope/keys/rto/rpo/etc.) for review and caps confidence
  - MFA `required` is only allowed when evidence contains `required` or `must`/`enforced` near MFA; otherwise answer is rewritten to requirement-not-specified
  - confidence/needsReview are deterministic by outcome:
    - NOT_FOUND => low confidence, needsReview true
    - PARTIAL => low/med confidence, needsReview true
    - FULL => med/high confidence only when all required details are covered
  - confidence is never `high` when `needsReview=true`, when answer includes `Not specified...`, or when question category is `OTHER`
- `/ask` UI for one-question evidence-grounded responses
- Questionnaire CSV import + question-column selection + batch autofill + CSV export
- `/questionnaires` UI for import, preview, autofill/resume, rerun-missing, archive, and export actions
- Questionnaire details page at `/questionnaires/[id]` with per-question answers/citations filters
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
