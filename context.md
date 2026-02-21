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
- `/ask` UI for one-question evidence-grounded responses
- Questionnaire CSV import + question-column selection + batch autofill + CSV export
- `/questionnaires` UI for import, preview, autofill/resume, and export actions
- Resumable autofill run state on `Questionnaire` (`PENDING/RUNNING/COMPLETED/FAILED`) with progress counters
- Homepage shortcuts: `Go to Documents`, `Go to Questionnaires`, `Go to Ask`, `Open API Health`, `Open API Documents`

## 5) Current Endpoints and Pages

Pages:
- `/` (home)
- `/documents` (upload + list)
- `/questionnaires` (CSV import + autofill + export)
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

## 9) Next Milestones

- Day 5: evidence-aware answer approval workflow and reviewer UX
- Day 6: XLSX support + larger questionnaire performance improvements
