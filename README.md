# securityq-autofill

Security Questionnaire Autofill + Evidence Finder (MVP scaffold).

## Project Context

- [Project context snapshot](context.md)
- [Build log and day-by-day summaries](docs/build-log.md)

## Current Pages and APIs

- Home: `http://localhost:3000/`
- Documents UI: `http://localhost:3000/documents`
- Questionnaires UI: `http://localhost:3000/questionnaires`
- Trust Queue UI: `http://localhost:3000/trust-queue`
- Approved Answers Library UI: `http://localhost:3000/approved-answers`
- Ask UI (DEV only): `http://localhost:3000/ask`
- Documents API: `http://localhost:3000/api/documents`
- Embed Chunks API: `POST http://localhost:3000/api/documents/embed`
- Answer Question API: `POST http://localhost:3000/api/questions/answer`
- Questionnaires API: `GET http://localhost:3000/api/questionnaires`

## Local Runbook

Option A (recommended):

```bash
npm install
npm run test:db
npm run dev
```

Option B (manual port selection):

```bash
npm install
export POSTGRES_PORT=5434
docker compose up -d
export DATABASE_URL="postgresql://postgres:postgres@localhost:${POSTGRES_PORT}/app?schema=public"
npx prisma migrate deploy
npm test
npm run dev
```

Troubleshooting:

- If `5433` is already in use, `npm run test:db` automatically selects the first open port in `5434..5439`.
- Manual runs can pick any port in `5433..5439` by setting `POSTGRES_PORT` before `docker compose up -d`.

Verification:

```bash
curl -X POST http://localhost:3000/api/documents/embed
```

Then verify:

- Ask flow at `http://localhost:3000/ask` (when `DEV_MODE=true`)
- CSV flow at `http://localhost:3000/questionnaires`
- Trust Queue review flow at `http://localhost:3000/trust-queue`

## DEV_MODE

- `DEV_MODE` defaults to `false`.
- When `DEV_MODE=false`, `/ask` is not accessible and debug payloads are suppressed from answer/autofill APIs.
- Set `DEV_MODE=true` to enable `/ask` and debug features.

## Running Tests

- Run all tests: `npm test`
- Run the resilient local DB test runbook: `npm run test:db`
- MVP tests are fixture-based and mock OpenAI calls, so they do not require network access.
