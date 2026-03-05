# repo-audit-claimops-01

- Audit timestamp (UTC): 2026-03-05T21-32-15Z
- Scope: static + runbook verification only (no runtime behavior changes)
- Repo root: `/Users/anweshsingh/Downloads/Attestly/securityq-autofill`

## Executive Summary

- Docs (`context.md`, `docs/build-log.md`, `README.md`) consistently claim Evidence-first answering with strict NOT_FOUND/PARTIAL templates, org-scoped APIs, and RBAC-enforced routes.
- Core answer invariants are enforced in `src/server/answerEngine.ts` normalization and extractor/legacy branches; non-NOT_FOUND responses are citation-gated in server paths.
- A potential invariant bypass exists in extractor-invalid fallback path: NOT_FOUND detection uses exact-string equality (not template-like normalization), so near-template variants could slip through with citations.
- API surface is mostly consistent: protected routes derive context from `getRequestContext()`, most business routes enforce `assertCan(...)`, and ID-based lookups are org-scoped with anti-enumeration 404s.
- Exceptions are intentional and bounded: auth/session routes (`/api/auth/*`, `/api/me*`, invite acceptance) do not use `assertCan` because they are identity/context operations.
- JSON error-envelope policy is broadly followed through `jsonError(...)` / `toApiErrorResponse(...)`; `/api/auth/[...nextauth]` is framework-managed and not normalized to this envelope.
- No hardcoded questionnaire/document IDs or question-text-specific branching logic was found in runtime code.
- Test/build runbook passed end-to-end; expected warnings observed (RBAC-negative test logs, Next.js dynamic-server-usage build warnings).
- UI audit script exists and ran; serious/critical axe violations are 0/0 for audited questionnaire route; unauthenticated route data calls produce expected 401 console/network noise.

## Current Product Invariants (Docs Claims + Code Verification)

### Claimed in docs

- Source docs read first:
  - `context.md`
  - `docs/build-log.md`
  - `README.md`
- Current status claims:
  - `Phase 2: COMPLETE` (in `context.md` and `docs/build-log.md`)
- Claimed non-negotiables (from `context.md`):
  - FOUND answers require non-empty citations.
  - NOT_FOUND exact text: `Not found in provided documents.` with empty citations.
  - PARTIAL exact text: `Not specified in provided documents.` when evidence exists but specifics missing.
  - No doc-template-specific keyword/canned-answer logic.

### Verified in code

- NOT_FOUND exact literal and canonical response:
  - `src/server/answerEngine.ts:71`
  - `src/server/answerEngine.ts:117-121`
- PARTIAL exact literal source:
  - `src/lib/claimCheck.ts:1`
  - used directly in extractor PARTIAL branch: `src/server/answerEngine.ts:885-891`
- Non-NOT_FOUND requires citations enforced in server answer path:
  - normalization hard-stop on empty citations: `src/server/answerEngine.ts:337-340`
  - extractor branch hard-stop when citations empty: `src/server/answerEngine.ts:874-883`
  - legacy/grounded branch hard-stop when citations empty: `src/server/answerEngine.ts:942-946`
- Approval path also blocks NOT_FOUND approvals + empty citationChunkIds:
  - `src/app/api/approved-answers/route.ts:67-82`
  - `src/app/api/approved-answers/[id]/route.ts:73-88`

## System Map

### Repo map (depth-2, excluding `.git`/`node_modules`/`.next*`)

```bash
find . -maxdepth 2 \
  \( -path './.git' -o -path './node_modules' -o -path './.next' -o -path './.next_broken_20260226_0132' -o -path './.next_stale_20260226_0106' \) -prune \
  -o -type d -print | sort
```

Key directories:

- `src/app` (App Router pages + API routes)
- `src/server` (answer engine + RBAC)
- `src/lib` (org membership/context/helpers/services)
- `prisma` (schema + migrations)
- `scripts` (ui audit script)
- `test/fixtures` (deterministic fixtures)

### Key entrypoints

- Answer pipeline:
  - `src/server/answerEngine.ts`
  - Callers:
    - `src/app/api/questions/answer/route.ts`
    - `src/lib/questionnaireService.ts` (autofill batch)
- RBAC + request context:
  - `src/server/rbac.ts`
  - `src/lib/requestContext.ts`
- API routes:
  - `src/app/api/**/route.ts` (24 route handlers)
- Questionnaire review UI routes:
  - `src/app/questionnaires/page.tsx`
  - `src/app/questionnaires/[id]/page.tsx`

## Answer Pipeline Trace (Q -> retrieval -> rerank -> gate -> output)

1. Input question enters `answerQuestion(...)` (`src/server/answerEngine.ts:723`).
2. Retrieval:
   - embedded chunk availability check (`countEmbeddedChunksForOrganization`)
   - vector retrieval (`retrieveTopChunks`) with `topK=12`.
3. Deterministic rerank:
   - lexical overlap + vector score (0.7/0.3 blend)
   - `rerankedTopN=5`.
4. Gate:
   - extractor gate (`generateEvidenceSufficiency`) by default in dev/test or `EXTRACTOR_GATE` flag.
   - fallback legacy gate when extractor gate disabled.
5. Decision:
   - `NOT_FOUND` -> canonical not-found response.
   - `PARTIAL` -> exact `Not specified in provided documents.` + citations.
   - `FOUND` -> composed answer from extracted requirement/value pairs (extractor mode) or grounded model output (legacy mode).
6. Normalization/guardrails:
   - `normalizeAnswerOutput(...)` applies format and citation checks + claim-check guardrails before final response.

Notable conditional fallback path:

- If extractor result is invalid/shape-repaired, code uses `generateGroundedFallbackFromReranked(...)` (`src/server/answerEngine.ts:624-671`) and returns low-confidence + needsReview response.

## Multi-tenancy / RBAC Coverage Summary

### Route coverage table

Legend:
- `Ctx`: uses `getRequestContext()` (auth + active org)
- `RBAC`: uses `assertCan(...)`
- `Org scope`: Prisma/service lookups anchored to active org
- `404 anti-enum`: out-of-org ID treated as not found
- `JSON errs`: uses `jsonError(...)` / `toApiErrorResponse(...)` (or explicit `NextResponse.json({ error })`)

| Route | Ctx | RBAC | Org scope | 404 anti-enum | JSON errs | Notes |
|---|---|---|---|---|---|---|
| `/api/auth/[...nextauth]` | no | no | n/a | n/a | framework | NextAuth-managed handler |
| `/api/auth/context` | yes | no | yes | n/a | yes | auth context endpoint |
| `/api/dev/role` | yes | no | yes | n/a | yes | DEV-only self-role switch |
| `/api/me` | yes | no | yes | partial | yes | identity/context endpoint |
| `/api/me/active-org` | yes | no | yes | n/a | yes | active-org switch |
| `/api/org/invites/accept` | yes | no | mixed | n/a | yes | token acceptance flow |
| `/api/documents` | yes | yes | yes | n/a | yes | list |
| `/api/documents/upload` | yes | yes | yes | n/a | yes | create |
| `/api/documents/embed` | yes | yes | yes | n/a | yes | embed |
| `/api/documents/[id]` | yes | yes | yes | yes | yes | get/delete |
| `/api/org/invites` | yes | yes | yes | yes | yes | create/list org invite context |
| `/api/org/members` | yes | yes | yes | n/a | yes | list |
| `/api/org/members/[userId]` | yes | yes | yes | yes | yes | patch |
| `/api/questionnaires` | yes | yes | yes | n/a | yes | list |
| `/api/questionnaires/import` | yes | yes | yes | n/a | yes | create |
| `/api/questionnaires/headers` | yes | yes | n/a | n/a | yes | parses uploaded CSV only |
| `/api/questionnaires/[id]` | yes | yes | yes | yes | yes | get/delete |
| `/api/questionnaires/[id]/autofill` | yes | yes | yes | yes | yes | batch autofill |
| `/api/questionnaires/[id]/export` | yes | yes | yes | yes | yes | success payload is CSV |
| `/api/questionnaires/[id]/approve-reused` | yes | yes | yes | yes | yes | bulk approve exact-reuse |
| `/api/questions/answer` | yes | yes | yes | n/a | yes | single question answer |
| `/api/questions/[id]/review` | yes | yes | yes | yes | yes | review status update |
| `/api/approved-answers` | yes | yes | yes | yes | yes | create |
| `/api/approved-answers/[id]` | yes | yes | yes | yes | yes | patch/delete |

### Repro command used

```bash
printf "route|getRequestContext|assertCan|orgScopeHint|notFound404|jsonErrorHelper\n"; \
for f in $(rg --files src/app/api | rg '/route\.ts$' | sort); do
  # grep-based static classification
  ...
done
```

(See shell output in terminal history for deterministic per-file flags.)

## Testing Harness Summary

- Unit/integration tests are deterministic and heavily mock OpenAI-bound behavior via Vitest mocks.
- Representative mock points:
  - `vi.mock("@/lib/openai", ...)` across engine and API test suites.
  - `vi.mock("@/server/answerEngine", ...)` in workflow tests.
- Fixtures live in:
  - `test/fixtures/` (`.pdf`, `.txt`, `.csv` deterministic artifacts)
- Diagnostic test is intentionally gated:
  - `src/server/answerEngine.diagnose-all-notfound.test.ts`
  - runs only with `RUN_EXTRACTOR_DIAGNOSE=true`.

## Non-negotiables Verification (Static)

### Exact template verification

Command:

```bash
rg -n "Not found in provided documents\.|Not specified in provided documents\." src
```

Findings:

- Canonical NOT_FOUND source: `src/server/answerEngine.ts:71`.
- Canonical PARTIAL source: `src/lib/claimCheck.ts:1`.
- Templates appear in additional files for policy checks and UX text (approved answer routes/UI), but no question-text ID branching was found.

### Citation requirement for non-NOT_FOUND

Commands:

```bash
rg -n "citations.length === 0|normalizeAnswerOutput\(|NOT_FOUND_RESPONSE" src/server/answerEngine.ts
rg -n "citationChunkIds must be non-empty|Cannot approve an empty or not-found answer" src/app/api/approved-answers
```

Findings:

- Enforced server-side in answer engine and approval endpoints (not UI-only).

### Potential bypass path (record only, no fix)

- `generateGroundedFallbackFromReranked(...)` uses `answer === NOT_FOUND_TEXT` exact equality (`src/server/answerEngine.ts:650`) rather than template-like normalization.
- If model output varies punctuation/casing around NOT_FOUND template, this fallback path may return a near-template string with citations.
- This path is guarded by extractor-invalid conditions, but still a trust-invariant drift risk.

## No-Hardcode / Anti-Drift Audit

Commands:

```bash
rg -n --glob '!**/*.test.ts' --glob '!test/**' \
  'question(Text)?\.includes\(|questionnaireId\s*===|documentId\s*===|rowIndex\s*===|canned|keyword map|hardcod' src

rg -n --glob '!**/*.test.ts' --glob '!test/**' \
  '(least privilege|TLS 1\.2|AES-256|PCI DSS|SOC 2|ISO 27001)' src
```

Notes:

- No doc-template-specific branching on question text, filenames, questionnaire/document IDs was found in runtime code.
- Constants in tests/fixtures are expected and allowed.

| Finding category | File | Why risky | Severity | Recommended remediation |
|---|---|---|---|---|
| Template drift (duplicate literals) | `src/server/answerEngine.ts`, `src/lib/approvedAnswerReuse.ts`, `src/app/api/approved-answers/route.ts`, `src/app/api/questionnaires/[id]/approve-reused/route.ts`, `src/app/questionnaires/[id]/page.tsx` | Same semantic template is duplicated in multiple modules; future drift could break exact-match assumptions | medium | Centralize canonical template exports and consume from one source |
| Fallback normalization gap | `src/server/answerEngine.ts:624-671` | Extractor-invalid fallback checks exact NOT_FOUND equality only | high | Reuse `isNotFoundTemplateLike(...)` and normalize template variants before return |
| DEV role escalation surface | `src/app/api/dev/role/route.ts:31-45` | Any authenticated dev user can set own role when `DEV_MODE=true`; safe in local dev but risky if misconfigured shared env | medium | Add explicit environment guardrail checklist + optional allowlist in non-local env |
| Auth-route envelope inconsistency | `src/app/api/auth/[...nextauth]/route.ts` | Framework-managed route does not follow project JSON envelope contract | low | Document as intentional exception in API policy docs |
| Continuous UI-audit noise | UI audit unauthenticated runs (`artifacts/ui-audit/*`) | Protected-route 401 console/network entries obscure real regressions | low | Add authenticated storageState run for CI audit mode |

## Server Actions Safety Check

Command:

```bash
rg -n '"use server"' src
```

Result:

- No `"use server"` files found in `src/`.
- Therefore no non-async server action exports detected.

## Verification Runbook Results

Commands run exactly:

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm test
npm run build
```

Results:

- `docker compose up -d`: PASS (db container already running)
- `npm install`: PASS (no package changes)
- `npx prisma migrate deploy`: PASS (no pending migrations)
- `npm test`: PASS (22 passed, 1 skipped test files)
  - Notable expected logs:
    - RBAC negative-path `ForbiddenRoleError` stderr lines in integration tests
    - one expected unique-constraint test log in approval schema test
- `npm run build`: PASS
  - Notable expected warnings:
    - Next.js dynamic server usage warnings for auth-protected API routes using `headers`

## UI Audit Script (present and executed)

Script detection:

- `package.json` includes `"ui:audit": "node scripts/ui_audit_questionnaire.js"`.

Command run:

```bash
npm run ui:audit -- http://localhost:4010/questionnaires/cmmd2c8d700107uyr2fo86qfe
```

Artifacts:

- Raw output dir: `artifacts/ui-audit/2026-03-05T21-35-44-160Z/`
- Repo-audit copy: `artifacts/ui-audit/2026-03-05T21-35-44-160Z/repo-audit/`

A11y result:

- serious: `0`
- critical: `0`

Notes:

- Unauthenticated run reports expected 401 console/network entries for protected data calls.

## Manual Smoke Checklist

Dev server run:

```bash
npm run dev -- --port 4010
```

Checks performed:

- `HEAD /documents` -> `200`
- `HEAD /questionnaires` -> `200`
- `HEAD /settings/members` -> `200`
- `HEAD /ask` -> `404` (observed behavior aligns with DEV-only gating when `DEV_MODE` is not enabled)
- `HEAD /questionnaires/cmmd2c8d700107uyr2fo86qfe` -> `200`
- UI audit + server logs showed no crash loops; errors were auth-related 401s for protected API fetches in unauthenticated context.

## Risks / Gaps (Prioritized)

1. **High**: extractor-invalid fallback path can bypass template-like NOT_FOUND normalization (`src/server/answerEngine.ts:624-671`, especially `:650`).
2. **Medium**: canonical template literals are duplicated across server/API/UI files (drift risk).
3. **Medium**: DEV role switch endpoint allows self-role mutation for any authenticated dev user when `DEV_MODE=true`.
4. **Low**: framework auth route (`/api/auth/[...nextauth]`) is outside JSON-envelope policy; this is likely intentional but undocumented as exception.
5. **Low**: unauthenticated UI audit signal is noisy (401 console/network), reducing automated regression signal quality.

## Recommendations (Next 2-3 PR-sized initiatives for Continuous Trust QA / ClaimOps)

1. **Invariant Sentinel PR**
   - Add deterministic contract tests asserting:
     - exact NOT_FOUND/PARTIAL output templates
     - non-NOT_FOUND must always include citations
     - extractor-invalid fallback path also respects template-like normalization.
   - Output: CI trust-gate for answer invariants.

2. **API Policy Conformance PR**
   - Add a route-policy linter/test that snapshots all `src/app/api/**/route.ts` for:
     - `getRequestContext` presence (where required)
     - `assertCan` usage on business routes
     - org scope for ID-based Prisma lookups
     - JSON error envelope conformance and documented exceptions.
   - Output: continuous org/RBAC drift detection.

3. **Authenticated UI Audit PR**
   - Extend UI audit automation to use authenticated storage state.
   - Track stable metrics: console errors/warnings, network failures, axe serious/critical counts across protected routes.
   - Output: high-signal UI trust QA artifacts suitable for release gates.

