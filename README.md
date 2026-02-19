# securityq-autofill

Minimal Next.js + Postgres (pgvector) + Prisma scaffold.

## Day 1 - Runbook

```bash
docker compose up -d
npm install
npx prisma migrate dev --name init
npm test
npm run dev
```
