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
