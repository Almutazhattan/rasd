# Architecture

## The shape of it

```
┌─ browser ───────────────────────────────────────────────────────────┐
│  Next.js App Router · Arabic RTL · server components              │
└───────────┬──────────────────────────────────────┬─────────────────┘
            │ reads (server components)            │ writes (HTTP)
            ▼                                      ▼
┌─ src/server/** — services ─────────────────────────────────────────┐
│  accounts · company · tenders · analysis · documents · drafts      │
│  approvals · reports · notifications · jobs                        │
│  Every mutating call starts with assertCan(role, permission).      │
└───────────┬──────────────────────────────────────┬─────────────────┘
            │                                      │
            ▼                                      ▼
┌─ src/lib/tenancy.ts ───────────┐   ┌─ src/agents/** ───────────────┐
│  ScopedDb: every query is      │   │  registry · runner · tools    │
│  constrained to one org_id     │   │  contracts · provider adapter │
└───────────┬────────────────────┘   └───────────┬───────────────────┘
            ▼                                    ▼
      PostgreSQL (Kysely)                  Anthropic API
            ▲
            │
┌─ src/server/worker.ts ─────────────────────────────────────────────┐
│  claims jobs with FOR UPDATE SKIP LOCKED; runs analyses, discovery,│
│  drafting and the deadline sweep outside the request cycle         │
└────────────────────────────────────────────────────────────────────┘
```

Four rules hold across the layers:

1. **No service reads `getDb()` for customer data.** It goes through `ScopedDb`,
   which cannot be constructed without an organization.
2. **No agent imports a vendor SDK.** Agents see `LlmProvider`.
3. **No page performs a mutation directly.** Pages read; mutations go through
   HTTP routes, so the API is real and documented rather than incidental.
4. **No number reaches the UI without a stored origin.** Scores carry their
   methodology; claims carry a provenance.

---

## Tenant isolation

`src/lib/tenancy.ts` is the security centre of the application.

```ts
const s = scoped(ctx);                    // ctx carries userId, orgId, role
await s.from('tenders').selectAll();      // → WHERE tenders.org_id = $1
await s.insert('tenders', values);        // → org_id forced onto the row
await s.update('tenders').set(...);       // → WHERE tenders.org_id = $1
await s.getById('tenders', id);           // → 404 for another tenant's id
```

Three properties make this hold rather than merely encourage it:

- **The scope is applied before the caller sees the builder.** There is no
  `ScopedDb` method that returns an unfiltered query, so forgetting the filter
  is not an available mistake.
- **`insert` overwrites `org_id`** after spreading the caller's values. A caller
  that passes another tenant's `org_id` writes into its own tenant; the test
  `inserts are stamped with the acting workspace` covers exactly this.
- **The predicate is qualified** as `<table>.org_id`. An unqualified `org_id`
  is ambiguous the moment two tenant tables are joined, and PostgreSQL rejects
  the query — which is how an early version of this was caught, in
  `tests/workflow.test.ts`.

`sessions` is the single deliberate exception: its `org_id` points at the
session's active workspace, and a session must resolve *before* any scope
exists. It is read only through `src/lib/session.ts`, keyed by the token hash.
`tests/schema-parity.test.ts` asserts that `sessions` is the *only* exception —
any new table with an `org_id` that is missing from `TENANT_TABLES` fails the
build's test step.

Deletion cascades from `organizations`, so removing a tenant removes its data;
the parity test asserts `ON DELETE CASCADE` on every `org_id` foreign key.

---

## The agent engine

### Eight agents, one responsibility each

| Agent | Responsibility | Tools |
|---|---|---|
| `orchestrator` | plan, delegate, decide the human checkpoints | 5 |
| `discovery` | rank retrieved records against the company | 2 |
| `document_intelligence` | requirements, dates, attachments, with page refs | 4 |
| `compatibility` | six dimensions with evidence | 7 |
| `compliance` | per-requirement status; flag disqualifiers | 5 |
| `risk` | deadline, delivery, resource, financial, contractual | 4 |
| `drafting` | response sections and the requirement matrix | 6 |
| `quality_assurance` | audit the others; force review when needed | 4 |

A ninth definition, `recommendation`, writes the prose verdict after the engine
has computed the score — it is not a specialist, it is the narrator.

### The execution loop

`src/agents/runner.ts`, in order:

1. **Provider check.** If no provider is configured, write an `agent_runs` row
   with status `PROVIDER_UNCONFIGURED` and return. Nothing is simulated.
2. **Persist the run**, then a step per tool call and per validation failure.
3. **Offer only the agent's own tools**, plus a generated `submit_<agent>` tool
   whose input schema is derived from the agent's zod contract.
4. **Validate every tool input** against the tool's schema before the body runs.
5. **Take the result only through the submit tool.** A result that fails its
   contract is *not stored*: the validation error is returned to the model
   (`"Your result did not match the schema and was NOT stored"`), up to
   `maxRepairs`. After that the run fails with no output.
6. **Retry** transient provider failures with exponential backoff up to
   `maxAttempts`, under a wall-clock budget per run.

### Why the output contract is declared once

`src/agents/contracts.ts` declares each agent's output in zod.
`src/agents/jsonschema.ts` derives the JSON Schema sent to the model from the
same declaration. Writing both by hand is how a model ends up asked for one
shape and judged against another; `tests/jsonschema.test.ts` covers the
conversion, including that it **refuses** types it cannot represent rather than
emitting a permissive schema.

Two product rules are encoded in the shapes themselves rather than left to a
prompt:

- every claim carries a `provenance`, so an inference cannot be stored as a
  verified fact;
- `missingInformation` is a required field, so "not found" has somewhere to go
  other than a confident guess.

### Prompt injection

Tender documents are external content. The defence is structural, not textual:

- An agent can only call tools on **its own allowlist**, with **schema-validated
  arguments**. Injected text has no action available to it. A call to a real
  tool the agent does not hold is refused and recorded as a failed step.
- Document text is returned inside `<untrusted-document name=… page=…>`
  markers, and every agent's system prompt states that content inside them is
  quoted material: never an instruction, never a reason to change task, and a
  finding to report if it tries to be.
- The task context is passed as a JSON block labelled as platform data; the
  system prompt is the registry's, unchanged. `tests/agent-runner.test.ts`
  asserts that an injected string in the context does not alter the system
  prompt.

---

## Scoring: deterministic by design

`src/lib/scoring.ts` is pure, synchronous and has no I/O. The model proposes
dimension scores; the engine does the arithmetic.

```
score = Σ(dimension_raw × normalized_weight) / 100
```

Weights are per workspace and need not sum to 100 — they are normalized while
preserving their ratios. The engine **refuses to score a partial assessment**:
five dimensions out of six raises `ScoringError` rather than scoring what it has.

The verdict then applies, in this order:

1. **A blocking gap caps the verdict.** An unmet mandatory requirement means
   possible disqualification; a high score does not offset it. At score ≥ 55 the
   ceiling is `REQUIRES_FURTHER_REVIEW`, below that `NOT_RECOMMENDED`.
2. **Undetermined mandatory items** cap at `REQUIRES_FURTHER_REVIEW` — the
   eligibility question is open, which is not the same as answered favourably.
3. **Low confidence downgrades**, never upgrades.
4. **The QA agent can force a review** at any score.

Every applied rule is stored on the analysis with its plain-language reason, and
rendered in the UI. If the recommendation agent's verdict differs from the
engine's, the engine's is stored and `verdictOverridden: true` is recorded.

---

## Data model

40 tables. The groups that matter:

- **Tenancy and identity** — `organizations`, `users`, `memberships`,
  `sessions`, `verification_tokens`, `invitations`, `integrations`.
- **Company memory** — `company_profiles` with `capabilities`,
  `certifications`, `past_projects`, `company_documents`, and `document_chunks`
  carrying extracted text *with its page number*.
- **Tenders** — `tenders` (source, retrieval time, verification status, demo
  flag), `tender_documents` (including `readable`), `tender_requirements`
  (category, mandatory, doc ref, page ref, provenance, confidence),
  `tender_changes` (amendment history), `tender_qa`.
- **Analysis** — `analyses`, `score_dimensions`, `evidence` (provenance, source
  type, doc and page), `compliance_items` (mandatory, status, blocking),
  `risks`, `scoring_weights`.
- **Agent records** — `agent_runs` (plan, input, output, attempts, model,
  tokens, parent run) and `agent_steps` (ordinal, tool, input, output, status,
  duration). A completed analysis is replayable from these.
- **Human-in-the-loop** — `approval_requests`, `approval_decisions`,
  `response_drafts`, `response_sections` (with `open_points`),
  `requirement_mappings`, `draft_versions`, `comments`.
- **Operations** — `notifications`, `notification_preferences`, `audit_logs`,
  `jobs`, `saved_searches`, `bookmarks`, `reports`.

Migrations are forward-only and recorded in `_migrations`, applied one
transaction each. `db/migrations/*.sql` is authoritative;
`src/lib/db/types.ts` mirrors it and the parity test keeps them in step.

---

## Background work

An analysis makes several model calls and takes minutes. It must not live in a
request.

`startAnalysis` writes the `analyses` row and a `jobs` row, then returns. The
worker claims jobs with `SELECT … FOR UPDATE SKIP LOCKED`, so several workers
can run against one database without collisions. A job that exhausts its
attempts becomes `DEAD` with the reason on the row, rather than looping. Jobs
left `RUNNING` by a worker that died are requeued after 30 minutes.

The UI polls the analysis record while a run is in flight and stops after ten
minutes.

---

## Provider and source adapters

Two seams exist so a swap is a new file, not a rewrite:

- **`LlmProvider`** (`src/agents/provider.ts`). `AnthropicProvider` implements
  it; `UnconfiguredProvider` raises `PROVIDER_UNCONFIGURED`. Agents never import
  `@anthropic-ai/sdk`.
- **`ProcurementProvider`** (`src/server/providers/types.ts`). `EtimadProvider`
  and `DemoProvider` implement it. The discovery flow upserts by
  `(org, source, sourceRef)` and writes changed fields to `tender_changes`.
  Nothing downstream knows which provider produced a record — it reads
  `sourceKind` and `verification`, which is what keeps demonstration data from
  ever being presented as official.

---

## Request handling

`src/server/http/handler.ts` gives one error contract. `AppError` carries a
`publicMessage` and nothing else reaches the client: no stack trace, no SQL, no
provider message. Each response carries an `x-request-id` that appears in the
log line, so an operator can correlate a user's report with the server's record.

Rate limiting is a fixed-window counter in process memory, applied to the auth
endpoints. This is the right shape for a single instance and the wrong shape
behind several — stated here and in `docs/LIMITATIONS.md` rather than discovered
in production.

`src/middleware.ts` checks only for the *presence* of a session cookie, to avoid
a database round trip for signed-out visitors. It validates nothing; real
authentication happens in the app layout and in every route handler. Deleting
the file would change performance, not security.
