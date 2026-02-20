# securityq-autofill

Minimal Next.js + Postgres (pgvector) + Prisma scaffold.

## Build Log

[Build log and day-by-day summaries](docs/build-log.md)

## Day 1 - Runbook

```bash
docker compose up -d
npm install
npx prisma migrate dev --name init
npm test
npm run dev
```
