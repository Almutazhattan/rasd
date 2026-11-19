# Integrations

Each integration states its real status. "Implemented" and "verified against the
live service" are different claims, and they are kept apart here.

| Integration | Required for | Status |
|---|---|---|
| Anthropic API | running any agent | implemented; **not executed against the live API from this repository** |
| Etimad (اعتماد) | official tender discovery | adapter implemented and documented; **never executed against the live service** |
| Demonstration provider | local development | implemented and tested |
| SMTP | verification, reset and invitation email | **not implemented** — intent is logged |
| S3 storage | object storage in production | **not implemented** — refuses explicitly |

---

## Anthropic (the AI provider)

```bash
AI_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-…"
ANTHROPIC_MODEL="claude-sonnet-4-5"
AI_MAX_OUTPUT_TOKENS="8000"
AI_REQUEST_TIMEOUT_MS="120000"
```

`src/agents/provider.ts` implements `LlmProvider` over
`@anthropic-ai/sdk`: the messages API with tool use, an `AbortController`
timeout, and `maxRetries: 0` because the runner owns retry policy.

**Status.** The adapter is written against the documented API and the runner's
behaviour around it is covered by `tests/agent-runner.test.ts` and
`tests/workflow.test.ts` using a scripted provider — tool allowlisting, schema
rejection and repair, retries, timeouts and persistence are all exercised. The
*HTTP call to Anthropic itself* has not been made from this repository, because
no API key was used while building it. Set a key and run one analysis before
relying on it.

**Without a key**, `aiState()` reports `NOT_CONFIGURED`, every run records
`PROVIDER_UNCONFIGURED`, and the analysis stores no score. This is the designed
behaviour, not a degradation.

**Swapping provider.** Implement `LlmProvider` in a new file, return it from
`getProvider()`. No agent changes.

---

## Etimad (منصة اعتماد)

Etimad is the Saudi government procurement platform. **It does not publish an
open, self-service API.** Programmatic access is granted under a commercial or
governmental agreement, and the base URL, auth scheme and payload shape are
specified by that agreement.

```bash
ETIMAD_API_BASE="https://…"     # given to you with your credentials
ETIMAD_API_KEY="…"
```

`src/server/providers/etimad.ts` is written against the documented record shape
(`tenderId`, `tenderName`, `agencyName`, `lastOfferPresentationDate`, …), parses
responses with zod, and maps them to `NormalizedTender`.

**It is marked UNVERIFIED in its own source comment**, because it has never been
run against the live service from this repository. It therefore does exactly two
things:

- with no credentials: reports `NOT_CONFIGURED` and returns nothing — it never
  substitutes invented tenders;
- with credentials: calls the endpoint and maps the response, and surfaces a
  transport error, an unexpected status or an unexpected shape as that, rather
  than smoothing it over.

The response mapper rejects any record without an identifier, a title and an
entity instead of filling the gap. `estimatedValueBand` is left `null` because
Etimad does not publish an estimate — a guess there would be a fabricated
figure in a financial field.

**To bring it live:** obtain access, set the two variables, then verify a real
search before trusting the results. If the response shape differs from the
schema in that file, the adapter will say so in the UI note rather than import
anything.

**Do not scrape.** The alternative to an agreement is not scraping the site;
`addManualTender` exists so a team can enter a notice they are looking at, and
it is stored as `MANUAL` / `UNVERIFIED` and labelled that way everywhere.

---

## Demonstration provider

```bash
ENABLE_DEMO_PROVIDER="true"
```

Four fictional tenders for local development. Every record is stored with
`source_kind = DEMO`, `verification = DEMO_DATA`, `is_demo = true`, and is
labelled on every surface it appears on. Identifiers are prefixed `DEMO-` and
the contracting entity is a generic description, never the name of a real
government body — so a sample record cannot be mistaken for, or cited as, a real
notice. Agents are told in their task context that the record is sample data.

Set `false` in production.

---

## Email (SMTP)

```bash
SMTP_URL="smtps://user:pass@smtp.example.com:465"
MAIL_FROM="RASD <no-reply@rasd.sa>"
```

**Not implemented.** No SMTP transport ships in this repository.

What happens instead is deliberate rather than silent: `mailState()` reports
`NOT_CONFIGURED`; the UI says email is not configured on the pages where it
matters; verification, reset and invitation tokens are surfaced to the operator
(returned by the API in non-configured mode, and logged) so a local flow can be
completed by hand; and the notification service logs the intent instead of
reporting a delivery that did not happen.

**To implement:** add a transport (nodemailer or an HTTP provider) behind a small
`sendMail` function, and call it from the three places that currently log —
`register`, `requestPasswordReset`, `inviteMember` — and from `notify` for
`email: true` preferences. Keep the "not configured" branch: it is what makes
the absence visible.

---

## File storage

```bash
STORAGE_DRIVER="local"          # or "s3"
STORAGE_LOCAL_DIR="./storage"
MAX_UPLOAD_BYTES="26214400"

S3_BUCKET=""
S3_REGION=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_ENDPOINT=""                  # for S3-compatible services
```

The **local** driver is implemented and tested: generated keys, path containment,
mode 0600, downloads proxied through an authenticated route.

The **S3** driver is **not implemented**. With `STORAGE_DRIVER=s3`, `putFile`
and `getFile` throw a clear error naming the limitation. This is the honest
failure: writing to a half-configured bucket, or silently falling back to local
disk in a container that is about to be replaced, both lose documents.

**To implement:** add `@aws-sdk/client-s3`, implement the three functions in
`src/server/storage.ts` behind the existing `STORAGE_DRIVER` branch, and keep
downloads proxied (or switch to short-lived presigned URLs — the authorization
check must stay).

---

## An authorized search tool

`authorized_web_search` is registered as a tool and **deliberately unwired**: it
returns `{ state: 'NOT_CONFIGURED', results: [] }` with a note telling the agent
that no information is available and that remembered or assumed information is
not a substitute for a search result.

Wire it to a real search API if you want it, in `src/agents/tools.ts`. Before
you do: consider what external queries would reveal about a client's bidding
interest, and whether that is acceptable to them.
