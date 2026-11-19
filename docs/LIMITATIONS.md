# Limitations

Everything this build does not do, or does not do fully. Written so nobody has
to discover it in production.

---

## Not implemented

| Area | State | Note |
|---|---|---|
| SMTP email | not implemented | tokens are logged / returned so local flows work; see INTEGRATIONS.md |
| S3 storage | not implemented | `STORAGE_DRIVER=s3` throws a clear error rather than mis-writing |
| `.docx` / `.pdf` export | not implemented | export produces Markdown and print-ready A4 HTML (see below) |
| Billing and payments | not implemented | the plan is a field; usage is shown from real agent runs, no gateway |
| Vector / semantic retrieval | not implemented | document search is PostgreSQL `ILIKE`; see below |
| Authorized web search tool | deliberately unwired | reports `NOT_CONFIGURED`; agents are told not to substitute assumptions |
| MFA, SSO, SCIM | not implemented | |
| Tender comparison UI | partial | `compareTenders` and `/api/tenders/compare` exist; no dedicated page yet |
| Saved-search alerts | partial | searches save and the schema carries `alert_active`; no scheduled run yet |
| English UI | partial | the public site and schema carry Arabic + English labels; workspace chrome is Arabic-only |

### Export formats

`exportDraft` produces Markdown and a self-contained print-ready HTML document
(A4, RTL, no external requests — print to PDF from the browser; the Markdown
opens in Word). Native `.docx` and `.pdf` writers are not included.

This was a deliberate trade: shipping a file named `.docx` that is actually HTML
is the kind of quiet dishonesty this product is built against. To add real
`.docx`, use `docx` or `officegen` behind a third branch in `exportDraft`; the
approval gate and the content assembly stay as they are.

### Document retrieval

`company_documents_search` is `ILIKE '%term%'` over `document_chunks`. It finds
a certificate by name; it will not find "security management system" in a
document that says "أمن المعلومات".

The chunk table is already shaped for embeddings (`page`, `ordinal`,
`char_count`). Adding pgvector, an `embedding` column and a similarity search in
that one tool would be a contained change, and would improve the compliance
agent's recall more than any prompt change.

---

## Not verified

The difference between "implemented" and "confirmed working" matters.

- **The Anthropic API call has not been made from this repository.** The adapter
  is written to the documented API, and everything around it — tool allowlisting,
  schema validation and repair, retries, timeouts, persistence — is covered by
  tests with a scripted provider. The live HTTP call is not. Run one analysis
  with a real key before relying on it.
- **The Etimad adapter has never run against the live service**, because access
  requires an agreement. Its source comment says so. With no credentials it
  reports `NOT_CONFIGURED` and returns nothing.
- **PDF extraction is exercised on small synthetic files**, not on a 300-page
  Arabic conditions booklet. `pdf-parse` handles Arabic text layers; a scanned
  booklet has no text layer at all and is correctly marked unreadable, but no OCR
  path exists.
- **No load testing.** Connection pool defaults (10) and the single-worker
  default are untested at volume.
- **No browser testing matrix.** Built and checked in a modern engine; RTL
  layout is CSS-logical throughout (`inset-inline`, `ms-`/`me-`) but not verified
  across browsers.

---

## Operational shape

- **Rate limiting is in-process memory.** With N replicas the effective limit is
  N× the configured one. Move it to Redis or Postgres before scaling out.
- **The job worker is a single polling loop** (2 s idle). Several can run safely
  — `FOR UPDATE SKIP LOCKED` prevents collisions — but there is no scheduler, so
  `DEADLINE_SWEEP` must be enqueued by cron or an external trigger.
- **No scheduled discovery.** `DISCOVER_TENDERS` runs on demand or when
  enqueued; nothing enqueues it periodically yet.
- **The analysis UI polls** rather than streaming. It stops after ten minutes.
- **No soft delete.** Deleting a tender or a member removes rows; the audit log
  retains the action but not the content.
- **`PROCESS_DOCUMENT` and `SEND_NOTIFICATIONS` job types exist but run inline.**
  The types are reserved so the work can move to the worker without a schema
  change; the worker logs that it handled them inline.

---

## Product boundaries (not gaps)

These are refusals, and they are tested.

- **RASD never submits a tender.** No submission code path exists. Export hands
  the authorized user a file.
- **A score never hides a mandatory eligibility failure.** Blocking items cap
  the verdict, and the capping rule is shown.
- **No invented experience, certification or figure.** The drafting agent
  returns `MISSING` with a `null` response where records do not support an
  answer; that list is the most useful thing it produces.
- **Demonstration data is never presented as a live tender.**
- **With no AI provider, nothing is produced.** `PROVIDER_UNCONFIGURED`, no
  score, no dimensions, no compliance items.
- **No probability of winning** is produced or implied, by any agent.

---

## If you take this further

In the order that would matter most:

1. Run one analysis with a real `ANTHROPIC_API_KEY` and read the agent step log.
   Everything else is theory until that is done.
2. Implement SMTP. Invitations and password resets are unusable without it.
3. Implement S3 (or mount durable storage). Local disk in a container loses
   documents on redeploy.
4. Move rate limiting out of process if you run more than one instance.
5. Add pgvector retrieval for company documents.
6. Add a real `.docx` writer.
7. Get Etimad access, then verify the adapter against the live response shape.
