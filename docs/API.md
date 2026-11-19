# HTTP API

Every endpoint is a Next.js route handler under `src/app/api/`.

**Conventions**

- JSON in, JSON out. Two exceptions take `multipart/form-data` (uploads); three
  return a file (`document download`, `draft export`, `report CSV`).
- Success: `{ "ok": true, "data": … }` with 200, or 201 on creation.
- Failure: `{ "ok": false, "error": { "code", "message" }, "requestId" }`.
  `error.message` is safe to show a user; nothing else about the failure is
  returned.
- A validation failure adds `error.fields: [{ path, message }]` with 422.
- Authentication is the `rasd_session` cookie, set by `POST /api/auth/login`.
  A request without it gets 401 `UNAUTHENTICATED`; with a session but no active
  workspace, 403 `FORBIDDEN`.
- Every response carries `x-request-id`, which appears in the server log.

**Error codes** → `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 ·
`CONFLICT` 409 · `FILE_TOO_LARGE` 413 · `UNSUPPORTED_FILE` 415 · `VALIDATION`
422 · `RATE_LIMITED` 429 · `INTERNAL` 500 · `PROVIDER_ERROR` 502 ·
`PROVIDER_UNCONFIGURED` 503 · `TIMEOUT` 504.

A record belonging to another workspace returns **404, not 403** — the API does
not confirm that it exists.

---

## Health

### `GET /api/health`
No auth. Runs a real query. 200 when the database is up, 503 otherwise.

```json
{ "status": "ok", "database": "up", "error": null,
  "integrations": { "ai": "NOT_CONFIGURED", "etimad": "NOT_CONFIGURED",
                    "demo": "DEMO", "mail": "NOT_CONFIGURED" },
  "latencyMs": 3, "at": "2026-01-01T00:00:00.000Z" }
```

---

## Authentication

### `POST /api/auth/register`
Rate limited: 5 per 10 min per IP. Creates the user, the workspace, the OWNER
membership and default weights; sets the session cookie.

```json
{ "name": "…", "email": "…", "password": "…10+ chars", "orgName": "…", "locale": "ar" }
→ 201 { "orgId", "slug", "emailDelivery", "verifyToken" }
```
`verifyToken` is returned **only** when SMTP is not configured, so a local flow
can be completed. Configure SMTP and it is omitted.

### `POST /api/auth/login`
Rate limited: 10 per 10 min per IP. Same error for unknown email and wrong
password.

```json
{ "email": "…", "password": "…" }
→ 200 { "userId", "name", "orgId", "role", "emailVerified" }
```

### `POST /api/auth/logout`
Revokes the session row and clears the cookie. → `{ "signedOut": true }`

### `POST /api/auth/forgot-password`
Rate limited: 5 per 15 min. **Always** reports acceptance, whether or not the
address exists. → `{ "accepted": true, "emailDelivery", "note" }`

### `POST /api/auth/reset-password`
`{ "token", "password" }` → `{ "reset": true }`. Single-use, 1-hour token.
Deletes every session for that user.

### `GET /api/auth/verify-email?token=…`
→ `{ "verified": true | false }`. Single use, 48-hour token.

### `POST /api/workspaces/switch`
`{ "orgId": "uuid" }` → `{ "orgId" }`, or 403 if not a member.

---

## Company

### `GET /api/company/profile`
→ `{ profile, capabilities, certifications, pastProjects }`, or `null`.

### `PUT /api/company/profile` · `profile:update`
Saving **clears `confirmed_at`**: a changed profile needs confirming again, and
a `COMPANY_PROFILE` approval is raised.

```json
{ "legalName", "crNumber?", "industries[]", "activities[]", "sizeBand?",
  "services[]", "regions[]", "employeeCount?", "annualRevenueBand?",
  "bondingCapacity?", "summary?" }
→ { "profileId" }
```

### `POST /api/company/confirm` · `profile:confirm`
The human checkpoint. → `{ "confirmed": true }`

### `POST|DELETE /api/company/capabilities` · `profile:update`
`POST { "label", "level": 1-5 }` · `DELETE ?id=uuid`

### `POST|DELETE /api/company/certifications` · `profile:update`
`POST { "name", "issuer?", "number?", "issuedAt?", "expiresAt?", "documentId?" }`
A certification with `documentId` is stored `VERIFIED`; without it,
`USER_PROVIDED`.

### `POST|DELETE /api/company/projects` · `profile:update`
`POST { "title", "client?", "sector?", "valueBand?", "startedAt?", "endedAt?", "description?", "documentId?" }`

### `GET /api/company/readiness`
→ `{ "score": 0-100, "findings": [{ ar, en }], "expiring": [...] }`

---

## Documents

### `GET /api/documents`
→ company documents with `extracted_at`, `text_chars`, `expires_at`.

### `POST /api/documents` · `document:upload` · `multipart/form-data`
Fields: `file` (required), `title`, `kind`, `expiresAt?`.
Uploads, stores privately, extracts text per page and chunks it.

```json
→ 201 { "id", "pageCount", "textChars", "chunks", "readable", "note" }
```
`readable: false` with a `note` means no text was extracted — the document is
kept and downloadable but is not used as evidence, and the agents are told it is
unreadable.

### `DELETE /api/documents/[id]` · `document:delete`

### `GET /api/documents/[id]/download?kind=company|tender`
Re-checks session and tenant, then streams the bytes with
`Content-Disposition: attachment`, `no-store`, `nosniff`.

---

## Tenders

### `GET /api/tenders`
Query: `q`, `entity`, `sector`, `region`, `status`, `type`, `publishedAfter`,
`closesBefore`, `bookmarkedOnly`, `includeDemo`, `sort`
(`closing|published|title`), `page`, `pageSize` (5–100).

→ `{ "items": [...], "total", "page", "pageSize", "pages" }`

Every item carries `source_name`, `source_kind`, `verification` and `is_demo` —
the client is expected to render the label.

### `POST /api/tenders` · `tender:import`
Adds a tender by hand. Stored `MANUAL` / `UNVERIFIED`.

```json
{ "title", "entity", "referenceNo?", "sector?", "region?", "type?",
  "closesAt?", "publishedAt?", "estimatedValueBand?", "sourceUrl?",
  "summary?", "scopeOfWork?", "submissionNotes?" }
→ 201 { "id" }
```

### `GET /api/tenders/[id]`
→ `{ tender, documents, requirements, changes, qa, analyses, bookmarked }`

### `DELETE /api/tenders/[id]` · `tender:delete`

### `POST /api/tenders/[id]/bookmark`
Toggles. → `{ "bookmarked": true|false }`

### `POST /api/tenders/[id]/documents` · `tender:import` · `multipart/form-data`
Fields: `file`, `title`. Extracts and chunks with page references.

### `GET /api/tenders/discover`
→ `{ "providers": [{ key, label, state, isDemo, verification }] }`

### `POST /api/tenders/discover` · `tender:import`
```json
{ "keywords?": [], "sectors?": [], "regions?": [], "limit?": 50, "background": false }
→ { "imported", "updated", "skipped",
    "notes": [{ "provider", "state", "note" }] }
```
`notes` carries each provider's state verbatim — a `NOT_CONFIGURED` provider
says so there rather than silently contributing nothing. With
`"background": true` → `{ "jobId", "queued": true }`.

### `POST /api/tenders/compare`
`{ "ids": ["uuid", …] }` (max 6) → each tender with its latest analysis.

---

## Analysis

### `GET /api/analyses`
→ recent analyses with tender title, status, score, verdict, blocking gaps.

### `POST /api/analyses` · `analysis:run`
Queues a job; returns immediately. The worker executes it.

```json
{ "tenderId": "uuid" }
→ 201 { "analysisId", "status": "QUEUED" }
```

### `GET /api/analyses/[id]`
→ `{ analysis, tender, dimensions, evidence, compliance, risks, agents: { runs, steps } }`

`analysis.methodology` carries the weights used, each dimension's contribution,
the verdict rules that were applied, and — when the engine overrode the agent's
proposed verdict — `verdictOverridden: true` with `proposedVerdict`.

Terminal statuses: `COMPLETE`, `NEEDS_HUMAN_REVIEW`, `FAILED`,
`PROVIDER_UNCONFIGURED`. The last means no agent ran: `score`, `verdict` and all
child collections are empty, and `failure_reason` says why.

---

## Approvals

### `GET /api/approvals?status=PENDING|APPROVED|REJECTED|CHANGES_REQUESTED|CANCELLED|ALL`

### `GET /api/approvals/[id]`
→ the decision history with reviewer names.

### `POST /api/approvals/[id]` · `approval:decide`
```json
{ "status": "APPROVED" | "REJECTED" | "CHANGES_REQUESTED", "comment?": "…" }
→ { "requestId", "status" }
```
`REJECTED` requires a comment (422 without). A non-owner cannot approve a
request they raised themselves (403). An already-decided request returns 409.

---

## Response drafts

### `GET /api/drafts` → drafts with approval and export state.

### `POST /api/drafts` · `draft:write`
```json
{ "analysisId": "uuid", "background": true }
→ 201 { "jobId", "queued": true }          // or the draft, with background:false
```
409 if the analysis never ran (`PROVIDER_UNCONFIGURED`).

### `GET /api/drafts/[id]`
→ `{ draft, sections, mappings, versions, comments }`

`mappings` is the requirement matrix. A requirement with no company evidence has
`provenance: "MISSING"` and `response: null` — that is the output, not a gap in
it.

### `PATCH /api/drafts/[id]/sections` · `draft:write`
`{ "sectionId", "body", "heading?" }`. **Editing clears `approved_at`**: an
edited draft is not the approved draft, and export is refused again.

### `POST /api/drafts/[id]/version` · `draft:write`
`{ "note?" }` → `{ "version" }`. Snapshots the current content.

### `POST /api/drafts/[id]/comments`
`{ "body", "sectionId?" }` → 201

### `POST /api/drafts/[id]/export-approval` · `approval:request`
Raises the EXPORT checkpoint. 409 until the draft itself is approved.

### `GET /api/drafts/[id]/export?format=md|html` · `draft:export`
Returns the file. Refused unless **both** are true: the draft is approved
(409 otherwise) and an EXPORT approval exists (403 otherwise).

RASD does not submit anything — this hands the authorized user a file.

---

## Agents

### `GET /api/agents`
→ `{ provider: { state, model }, agents: [...], recentRuns: [...] }`

Each agent reports its tool allowlist and its budgets (`maxIterations`,
`maxAttempts`, `timeoutMs`). Runs report status, attempts, model and token
counts.

---

## Notifications

### `GET /api/notifications` → `{ items, unread }`

### `PATCH /api/notifications`
```json
{ "markAll?": true, "markRead?": ["uuid"],
  "preference?": { "kind", "inApp", "email" } }
```

---

## Reports

### `GET /api/reports`
No `kind` → saved reports.

With `kind` → builds it from stored rows.
`kind` ∈ `OPPORTUNITY_ANALYSIS` (needs `analysisId`) · `COMPANY_READINESS` ·
`COMPLIANCE` · `RISK` · `TENDER_COMPARISON` · `AGENT_EXECUTION` ·
`DECISION_HISTORY` · `ACTIVITY`.

`format=json|csv` — CSV carries a UTF-8 BOM so Excel opens Arabic correctly.
`save=true` persists it. A report of an empty workspace carries `emptyNote`
saying so rather than looking like a finding.

---

## Settings

### `GET /api/settings/weights` → `{ weights, labels }`

### `PUT /api/settings/weights` · `weights:update`
Six integers 0–100. They need not sum to 100 — the engine normalizes
proportionally. Applies to future analyses; past analyses keep the weights
recorded in their methodology.

---

## Team

### `GET /api/team` → `{ members, invitations, roles, you }`

### `POST /api/team/invite` · `member:invite`
`{ "email", "role" }` → 201 `{ "emailDelivery", "inviteToken" }`.
`inviteToken` is returned only when SMTP is not configured.

### `PATCH /api/team/[userId]` · `member:update`
`{ "role" }`. Refuses self-change (422); only an owner may change or grant
OWNER (403).

### `DELETE /api/team/[userId]` · `member:remove`
Refuses self-removal and owner removal. Deletes that user's sessions for the
workspace.
