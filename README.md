# RASD | رَصْد

**Beyond search. Towards winning opportunities.**
المنافسات الحكومية، بذكاء يتجاوز البحث.

An agentic-AI platform for Saudi government procurement. RASD learns a company,
discovers relevant tenders, reads the tender documents, measures fit against the
company's own records, surfaces compliance gaps and risks, explains its
reasoning, and prepares a response draft — with a human decision at every
critical step.

---

## What this repository is

A running multi-tenant SaaS application: Next.js front end, typed server layer,
PostgreSQL, session auth with six roles, eight orchestrated agents on the
Anthropic API, a background worker, and 125 automated tests that run against a
real PostgreSQL instance.

**What it will not do**, by design and by test:

| Guarantee | Where it is enforced | Where it is proven |
|---|---|---|
| Never submits a tender | no submission code path exists; export hands the user a file | `tests/workflow.test.ts` |
| A score never hides a mandatory eligibility failure | `src/lib/scoring.ts` caps the verdict | `tests/scoring.test.ts` |
| No invented experience, certification or figure | agent contracts require a provenance per claim; the drafting agent returns `MISSING` + `null` | `tests/workflow.test.ts` |
| With no AI provider, nothing is produced | run status `PROVIDER_UNCONFIGURED`, analysis stores no score | `tests/agent-runner.test.ts` |
| One tenant cannot read or write another's data | `src/lib/tenancy.ts` scopes every query | `tests/tenant-isolation.test.ts` |
| Demonstration data is never shown as a live tender | `source_kind = DEMO`, labelled on every surface | `tests/workflow.test.ts` |
| Export is impossible without two human approvals | `exportDraft` checks both server-side | `tests/workflow.test.ts` |

Known limitations are listed in [docs/LIMITATIONS.md](docs/LIMITATIONS.md) —
including which integrations have *not* been executed against a live service
from this repository. Nothing here is described as working that has not been run.

---

## Quick start

### With Docker (Postgres included)

```bash
cp .env.example .env
# set SESSION_SECRET (required) and ANTHROPIC_API_KEY (to run the agents)
openssl rand -base64 48            # paste into SESSION_SECRET

docker compose up --build
# app    → http://localhost:3000
# worker → runs the agent jobs
```

`docker compose up` applies the migrations before starting the app.

### Locally, against your own Postgres

```bash
# 1. requirements: Node 20.9+, PostgreSQL 14+
node -v && psql --version

# 2. install
npm install

# 3. configure
cp .env.example .env
#    DATABASE_URL   → your database
#    SESSION_SECRET → openssl rand -base64 48
#    ANTHROPIC_API_KEY → optional; without it the agents do not run (see below)

# 4. create the schema
npm run db:migrate

# 5. optional: two example workspaces with demonstration tenders
npm run db:seed
#    owner@alpha.test / rasd-dev-password
#    owner@beta.test  / rasd-dev-password

# 6. run — the app and the worker are separate processes
npm run dev          # http://localhost:3000
npm run worker       # in a second terminal

# 7. verify
npm run verify       # typecheck + 125 tests (needs TEST_DATABASE_URL, below)
```

### Running the tests

The tests drive a **real PostgreSQL database**, which they wipe on every run.
Point them at a throwaway database:

```bash
createdb rasd_test
TEST_DATABASE_URL="postgresql://localhost:5432/rasd_test" npm test
```

```
 ✓ tests/tenant-isolation.test.ts   (8)   two tenants, no leakage in either direction
 ✓ tests/auth.test.ts              (23)   hashing, sessions, reset, invitations
 ✓ tests/authorization.test.ts     (18)   the role matrix, enforced in services
 ✓ tests/scoring.test.ts           (16)   the engine's arithmetic and its verdict caps
 ✓ tests/agent-runner.test.ts      (13)   schema rejection, tool allowlist, retries
 ✓ tests/documents.test.ts         (14)   upload sniffing, page-aware chunking
 ✓ tests/jsonschema.test.ts         (8)   agent contracts → JSON Schema
 ✓ tests/schema-parity.test.ts      (8)   SQL and the typed mirror agree
 ✓ tests/workflow.test.ts          (17)   register → … → approved export, and the failures
   125 passed
```

---

## Running without an AI provider

The platform is usable with no `ANTHROPIC_API_KEY`: you can register, build the
company profile, upload and extract documents, discover and browse tenders, and
read every report.

What you **cannot** do is run an agent — and the platform says so rather than
pretending. An analysis queued without a provider finishes with status
`PROVIDER_UNCONFIGURED`, stores no score, no dimensions and no compliance items,
and the record states why. This is deliberate: a simulated agent result is worse
than no result, because a bid team cannot tell the difference.

---

## How the analysis runs

```
orchestrator  ── builds the plan, decides the human checkpoints
  │
  ├─ document_intelligence   requirements + dates + attachments, each with doc & page
  ├─ compatibility           six dimensions, 0–100 each, evidence per dimension
  ├─ compliance              per-requirement status; blocking items flagged separately
  ├─ risk                    deadline / delivery / resource / financial / contractual
  │
  ├─ scoring engine          ← deterministic, in code, not in the model
  ├─ quality_assurance       audits the other agents; can force human review
  └─ recommendation          prose only; the engine's verdict wins on conflict
  │
  └─→ approval checkpoints → NEEDS_HUMAN_REVIEW | COMPLETE
```

The weighted score is computed by `src/lib/scoring.ts` from the dimensions, and
the verdict is derived from the score **plus the things a score cannot express**:
unmet mandatory requirements, undetermined mandatory requirements, confidence,
and the QA flag. If the recommendation agent proposes a verdict the rules
disallow, the engine's verdict is stored and the override is recorded in the
analysis methodology — visible in the UI.

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js in development on :3000 |
| `npm run worker` | the job worker — analyses, discovery, drafting, deadline sweep |
| `npm run build` | production build |
| `npm start` | production server |
| `npm run db:migrate` | apply `db/migrations/*.sql` (forward-only, recorded) |
| `npm run db:migrate -- --reset` | drop and recreate the schema (refuses in production) |
| `npm run db:seed` | two example workspaces + demonstration tenders |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | the test suite (needs `TEST_DATABASE_URL`) |
| `npm run verify` | typecheck, then tests |
| `npm run lint` | ESLint |

---

## Layout

```
db/migrations/        authoritative SQL schema, forward-only
src/
  agents/             the eight agents
    contracts.ts      zod output contracts — one per agent
    registry.ts       system prompts, tool allowlists, budgets
    runner.ts         the execution loop: tools, validation, retries, persistence
    provider.ts       LLM provider adapter (Anthropic; swappable)
    tools.ts          the tool registry — every tool is tenant-scoped
    jsonschema.ts     zod → JSON Schema, so the contract is declared once
  lib/
    tenancy.ts        the tenant-isolation layer — the security centre of the app
    scoring.ts        the deterministic scoring and verdict engine
    rbac.ts           the permission matrix
    session.ts        session records (no framework coupling)
    password.ts       scrypt hashing
    db/               Kysely client and the typed schema mirror
  server/             services: accounts, company, tenders, analysis, drafts,
                      documents, approvals, reports, notifications, jobs, worker
    providers/        procurement sources: Etimad adapter + demonstration provider
    http/             request context and route-handler plumbing
  app/                Next.js App Router — 26 pages, 41 API routes
  components/         the design system and client forms
tests/                9 suites, run against a real PostgreSQL
docs/                 architecture, security, API, integrations, limitations, deployment
```

---

## Technology, and why

- **Next.js 14 (App Router) + React 18 + TypeScript (strict)** — server
  components read through the service layer directly; mutations go through
  documented HTTP routes, so there is a real API and not only a UI.
- **PostgreSQL + Kysely + hand-written SQL migrations.** Kysely gives
  compile-time-checked SQL with no code generation step, which matters here
  because `src/lib/tenancy.ts` wraps the query builder to make a tenant-scoped
  query the only kind a caller can build. `tests/schema-parity.test.ts` compares
  the typed mirror against the live database so the two cannot drift. An ORM
  with its own migration engine was the alternative; this was chosen so the SQL
  stays the single source of truth and the isolation layer stays enforceable.
- **Session cookies over a token in local storage** — httpOnly, `SameSite=Lax`,
  and only an HMAC of the token is stored, so a database leak alone cannot mint
  a session.
- **scrypt from `node:crypto`** at the OWASP parameters, rather than a native
  dependency that complicates the Docker build.
- **A PostgreSQL job queue** (`FOR UPDATE SKIP LOCKED`) rather than Redis — one
  fewer service to run, and an analysis takes minutes, not milliseconds.
- **Self-hosted fonts** (Thmanyah, by [thmanyah.com](https://thmanyah.com), under
  the Thmanyah Font License, in `public/fonts/`) — no third-party request, and
  the strict CSP in `next.config.mjs` stays strict.

---

## Interface

Arabic-first, RTL throughout, on a Charcoal / Sand / Blue palette. Marketing
pages carry a cinematic treatment; the workspace is dense and plain, because it
is read every day.

Two interface details are product decisions rather than styling:

- **Provenance is always visible.** Verified, company-provided, AI-inferred and
  missing are four different-looking things on screen. An inference never looks
  like a fact.
- **A score never appears alone.** The blocking-gap count sits beside it, and a
  capped verdict states the rule that capped it.

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the layers, the agent engine, the data model
- [docs/SECURITY.md](docs/SECURITY.md) — tenancy, authz, uploads, prompt injection, what is not covered
- [docs/API.md](docs/API.md) — every HTTP endpoint
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Anthropic, Etimad, SMTP, S3: what to request and set
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — what is not implemented, and what is untested
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment and operations

---

## Licence and attribution

Application code: add your own licence before distributing.

The Thmanyah font family in `public/fonts/` is owned by
[Thmanyah (ثمانية)](https://thmanyah.com) and used under the Thmanyah Font
Licence; it is not covered by this project's licence.

RASD is an analysis and preparation tool. It is not legal or financial advice,
it does not guarantee eligibility, and it does not guarantee the outcome of any
tender.
