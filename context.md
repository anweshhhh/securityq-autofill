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

## 4) Current Implemented Features (Day 1-2)

- Next.js App Router scaffold (TypeScript) with `src/` layout
- Docker Postgres with pgvector enabled
- Prisma models: `Organization`, `Document`, `DocumentChunk`, `ApprovedAnswer`, `Questionnaire`, `Question`
- `/api/health` endpoint
- Documents ingestion for `.txt` and `.md`: upload, extract text, chunk, store, list
- `/documents` UI for upload and document list
- Homepage shortcuts: `Go to Documents`, `Open API Health`, `Open API Documents`

## 5) Current Endpoints and Pages

Pages:
- `/` (home)
- `/documents` (upload + list)

API:
- `GET /api/health`
- `GET /api/documents`
- `POST /api/documents/upload`

## 6) Local Runbook

```bash
docker compose up -d
npm test
npm run dev
```

Then open:
- `http://localhost:3000/`
- `http://localhost:3000/documents`

## 7) Environment Variables

Use `.env.example` as the source of truth for required environment variables.  
Current key variable is `DATABASE_URL` (Postgres connection).

## 8) How We Work

- Use copy/pasteable prompts to Codex with explicit scope, constraints, acceptance criteria, and output format
- Review UI quickly, but assume backend correctness and data integrity need extra care
- Avoid extras not requested in the prompt; prefer small, reviewable increments
- Keep each change easy to verify locally

## 9) Next Milestones

- Day 3: embeddings + retrieval + single-question answering with citations
- Day 4: CSV batch autofill
