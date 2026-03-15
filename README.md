# Attestly V1 Prototype

This repository preserves the first working prototype of Attestly: a security questionnaire workflow that keeps generated and approved answers tied to uploaded evidence.

## Why This Exists

Security questionnaires are repetitive, high-friction, and hard to keep consistent across versions. This prototype explores a practical middle ground:

- ingest source evidence once
- ground answers in that evidence
- review answers in a focused queue
- preserve reusable approved answers with provenance

The goal of V1 was to validate the engine, trust model, and review workflow before investing in a full product rebuild.

## Current Status

- V1 prototype
- not production-hosted
- preserved as a working foundation and reference implementation
- V2 is planned as a separate redesign and rebuild

This is not the final product UI, deployment story, or architecture boundary set.

## What V1 Already Demonstrates

- evidence ingestion for `.txt`, `.md`, and `.pdf` files
- deterministic chunking plus OpenAI embeddings
- questionnaire CSV import, autofill, review, and export flows
- review-first workbench with citations, reuse, and approval controls
- reusable approved-answer library with freshness and provenance metadata
- workspace membership, roles, invites, and magic-link authentication
- org-scoped data isolation and RBAC-enforced API behavior

## High-Level Architecture

- `src/app`
  - Next.js App Router pages and API routes
- `src/components`
  - product UI, review workbench, navigation shell, and shared surfaces
- `src/server`
  - answer engine, trust/reuse logic, approved-answer flows, email helpers
- `src/lib`
  - auth/session helpers, Prisma access, ingestion utilities, retrieval helpers
- `prisma`
  - schema and migrations for users, orgs, evidence, questionnaires, and approvals

Core runtime shape:

- Next.js serves both UI and API routes
- Prisma talks to PostgreSQL with `pgvector`
- the answer engine retrieves evidence, scores candidates, and generates grounded outputs
- review state and approved answers are persisted for reuse and freshness checks

## Tech Stack

- Next.js 14
- TypeScript
- React
- Prisma
- PostgreSQL + pgvector
- NextAuth/Auth.js
- Nodemailer
- Vitest

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env vars:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Apply Prisma migrations:

```bash
npx prisma migrate deploy
```

5. Start the app:

```bash
npm run dev
```

Helpful checks:

```bash
npm run lint
npm test
npm run build
```

Optional local DB test helper:

```bash
npm run test:db
```

That helper will pick an open Postgres port in the local `5433..5439` range and run migrations plus the test suite against it.

## Environment Variables

Required for local development:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `EMAIL_SERVER`
- `EMAIL_FROM`

Optional:

- `OPENAI_CHAT_MODEL`
- `APP_URL`
- `DEV_MODE`
- `DEBUG_EVIDENCE`
- `EXTRACTOR_GATE`
- `ALLOW_INVITE_LINK_COPY`
- `POSTGRES_PORT`
- `AUTH_URL`
- `AUTH_SECRET`

The checked-in `.env.example` only contains placeholder values.

## Known Limitations Of V1

- local-first prototype; no hosted deployment included
- OpenAI is the only LLM provider wired into the answering path
- email auth uses development console logging unless SMTP is configured
- some compatibility routes remain from UI iteration history
- the UI is functional but not the final product direction
- background processing, observability, and operational tooling are minimal

## What Will Change In V2

- full UI and information-architecture rebuild
- cleaner product boundaries between review, evidence, and reusable answers
- stronger deployment and operations story
- more deliberate public product surface instead of prototype-era scaffolding
- tighter docs and packaging around the long-term product direction

## Demo Notes

There is no hosted demo for V1, and this repo intentionally does not ship screenshots that may drift from the current code. The safest way to evaluate it is to run it locally.

## Prototype Statement

This repository is a working prototype and engine foundation. It is useful as a reference for the underlying ingestion, grounding, review, and approval flows, but it should not be read as the final hosted Attestly product.
