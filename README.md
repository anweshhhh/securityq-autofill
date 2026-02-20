# securityq-autofill

Security Questionnaire Autofill + Evidence Finder (MVP scaffold).

## Project Context

- [Project context snapshot](context.md)
- [Build log and day-by-day summaries](docs/build-log.md)

## Current Pages and APIs

- Home: `http://localhost:3000/`
- Documents UI: `http://localhost:3000/documents`
- Health API: `http://localhost:3000/api/health`
- Documents API: `http://localhost:3000/api/documents`

## Local Runbook

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm test
npm run dev
```
