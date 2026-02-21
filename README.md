# securityq-autofill

Security Questionnaire Autofill + Evidence Finder (MVP scaffold).

## Project Context

- [Project context snapshot](context.md)
- [Build log and day-by-day summaries](docs/build-log.md)

## Current Pages and APIs

- Home: `http://localhost:3000/`
- Documents UI: `http://localhost:3000/documents`
- Questionnaires UI: `http://localhost:3000/questionnaires`
- Ask UI (supports debug toggle): `http://localhost:3000/ask`
- Health API: `http://localhost:3000/api/health`
- Documents API: `http://localhost:3000/api/documents`
- Embed Chunks API: `POST http://localhost:3000/api/documents/embed`
- Answer Question API: `POST http://localhost:3000/api/questions/answer`
- Questionnaires API: `GET http://localhost:3000/api/questionnaires`

## Local Runbook

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm test
npm run dev
```

Verification:

```bash
curl -X POST http://localhost:3000/api/documents/embed
```

Then verify:

- Ask flow at `http://localhost:3000/ask`
- CSV flow at `http://localhost:3000/questionnaires`
