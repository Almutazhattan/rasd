# Security

What is implemented, how it is verified, and what is **not** covered.

---

## Authentication

- **Passwords**: scrypt (`node:crypto`) at N=2^16, r=8, p=1, 64-byte key, random
  16-byte salt. The stored string is self-describing —
  `scrypt$N$r$p$salt$hash` — so parameters can be raised later without
  invalidating existing hashes; `needsRehash()` upgrades a hash on next login.
  Minimum length 10 characters, normalized NFKC before hashing.
- **Sessions**: a 32-byte random token in an httpOnly, `SameSite=Lax` cookie,
  `Secure` in production. Only `HMAC-SHA256(SESSION_SECRET, token)` is stored,
  so a database leak alone cannot mint a session — an attacker would also need
  the secret. 14-day expiry, `last_seen` refreshed at most hourly.
- **Account enumeration**: sign-in returns the same error for an unknown address
  and a wrong password, and spends comparable time on both. Password reset
  always reports acceptance. Both are asserted in `tests/auth.test.ts`.
- **Revocation**: a password reset deletes every session for that user. Removing
  a member deletes their sessions for that workspace. A session whose membership
  was revoked resolves with no workspace, so the user lands on the picker rather
  than inside a workspace they left.
- **Email verification** and reset tokens are single-use, hashed at rest, and
  expire (48 h and 1 h).

## Authorization

Six roles with an explicit permission matrix (`src/lib/rbac.ts`). Every mutating
service call begins with `assertCan(role, permission)`.

`tests/authorization.test.ts` calls the real service functions with a
low-privilege context and asserts `FORBIDDEN` — which is the only way to show
that a hidden button is not what is protecting the action. Specific guards:

- a reviewer cannot approve a request they raised themselves (unless owner);
- a rejection requires a reason;
- a decided request cannot be re-decided;
- nobody can change their own role, and only an owner may touch the owner;
- the owner cannot be removed.

## Tenant isolation

See [ARCHITECTURE.md](ARCHITECTURE.md#tenant-isolation). In short: every
customer-owned table carries `org_id`; `ScopedDb` is the only sanctioned access
path and applies the scope before the caller sees the builder; `insert` forces
`org_id`; `getById` returns 404 for another tenant's row rather than revealing
that it exists. `tests/schema-parity.test.ts` fails if a new table with an
`org_id` is not registered as tenant-scoped.

## Input validation

Every request body and query string is parsed with zod at the route boundary.
A validation failure returns 422 with per-field messages and never reaches a
service. Agent tool inputs are validated against the tool's own schema before
the tool body runs; agent outputs are validated against the agent's contract
before anything is persisted.

## File uploads

- Allowlisted MIME types only (PDF, DOCX, XLSX, DOC, PNG, JPEG, TXT).
- **Magic-number check**: the declared type must agree with the bytes. A PNG
  renamed `.pdf` is refused. Plain text is the one type with no signature, so it
  is checked for NUL bytes instead.
- Size limit (`MAX_UPLOAD_BYTES`, default 25 MiB) and an empty-file check.
- Storage keys are **generated**, never taken from user input, and the resolved
  path is checked to stay under the storage root, so `../` cannot escape it.
- Files are written with mode `0600` and are **never served from a public path**:
  `/api/documents/[id]/download` re-checks the session and the tenant before
  reading a byte, and responds with `no-store` and `nosniff`.

## Prompt injection and untrusted content

Tender documents are treated as data. The controls are structural:

1. An agent may only call tools on its own allowlist, with validated arguments.
   Injected text has no action available to it.
2. Document text is wrapped in `<untrusted-document>` markers, and every system
   prompt states that content inside them is quoted material — never an
   instruction, and a finding to report if it attempts to be one.
3. A call to a tool outside the allowlist is refused and recorded as a failed
   step, so an attempt is visible in the audit trail rather than silent.
4. Company data is not sent to external tools: the only outbound call is to the
   configured model provider, and the search tool is deliberately unwired (it
   reports `NOT_CONFIGURED`).

## Secrets

Read from the environment on the server only, validated at boot by
`src/lib/env.ts` so a missing `SESSION_SECRET` fails immediately rather than at
first use. No secret is referenced in client code, none is written to the
`integrations` table (which holds configuration, not credentials), and the
logger redacts any key matching `password|secret|token|api_key|authorization|cookie|hash`
at any depth.

## Output and error handling

`AppError.publicMessage` is the only text returned to a client. Stack traces,
SQL and provider messages stay in the server log, correlated by the
`x-request-id` header. The React error boundary shows a short message and the
digest, not the error.

## HTTP headers

Set in `next.config.mjs` for every route: a CSP with `default-src 'self'`,
`frame-ancestors 'none'`, `object-src 'none'` and no remote image or font
origins (fonts are self-hosted); `X-Frame-Options: DENY`;
`X-Content-Type-Options: nosniff`; `Referrer-Policy:
strict-origin-when-cross-origin`; a restrictive `Permissions-Policy`; and HSTS.

The CSP keeps `'unsafe-inline'` for styles and scripts, which Next.js requires
for its inline bootstrap without a nonce-based setup. Tightening it with a nonce
is listed in [LIMITATIONS.md](LIMITATIONS.md).

## Audit trail

Every state-changing action writes an `audit_logs` row: actor, action, target,
metadata, IP, timestamp. Agent runs and every step are persisted separately, so
an analysis is reconstructable after the fact. Approval decisions keep the
reviewer, the decision and the comment. Audit writes are best-effort — a failed
audit write is logged but never fails the user's action, and never swallows the
original error.

---

## Not covered

Stated plainly, because an unstated gap is worse than a known one.

- **No CSRF token.** Protection rests on `SameSite=Lax` cookies and
  JSON-only endpoints (a cross-site form post cannot set
  `Content-Type: application/json` without a preflight). Add a double-submit
  token before exposing this to a hostile origin set.
- **Rate limiting is per process and in memory.** Behind more than one replica,
  the effective limit multiplies by the replica count. Move the counter to Redis
  or a Postgres table.
- **No account lockout** after repeated failures, only rate limiting.
- **No MFA**, no SSO, no SCIM.
- **No encryption at rest** beyond what the database and filesystem provide.
  Uploaded documents are stored unencrypted under `STORAGE_LOCAL_DIR`.
- **No virus scanning** of uploads. Type and size are checked; content is not.
- **No signed URLs** for downloads — downloads are proxied through an
  authenticated route instead, which is slower but needs no key rotation.
- **The S3 storage driver is not implemented.** With `STORAGE_DRIVER=s3` the
  methods throw a clear error rather than writing somewhere unexpected.
- **No penetration test** has been performed against this code.
- **The CSP allows inline scripts and styles** (see above).

If you are deploying this for a real procurement team, treat the first three and
the last as blocking.
