# Deployment

## Requirements

- Node 20.9+ (or the provided Docker image)
- PostgreSQL 14+ (16 recommended; the test suite runs against 16)
- Durable storage for uploads — a mounted volume, or implement the S3 driver
- Outbound HTTPS to `api.anthropic.com`

Two processes must run: the **app** and the **worker**. Without the worker,
analyses stay `QUEUED` forever.

---

## Configuration

Copy `.env.example` and set at minimum:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/rasd"
SESSION_SECRET="$(openssl rand -base64 48)"     # required, 32+ chars
ANTHROPIC_API_KEY="sk-ant-…"                     # required to run agents
APP_URL="https://rasd.example.com"
NODE_ENV="production"
ENABLE_DEMO_PROVIDER="false"                     # off in production
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="/var/lib/rasd/storage"        # must be a durable mount
```

`src/lib/env.ts` validates on boot: a missing or short `SESSION_SECRET` fails
immediately with a readable message rather than surfacing later as a 500.

**`SESSION_SECRET` is load-bearing.** Session tokens are stored as an HMAC under
it; rotating it signs everyone out. Keep it in a secret manager, not in the
image.

---

## Docker Compose

```bash
cp .env.example .env     # set SESSION_SECRET and ANTHROPIC_API_KEY
docker compose up --build -d
docker compose logs -f app worker
```

The compose file runs Postgres, the app (which applies migrations on start) and
the worker, with a named volume for uploads and a health check on
`/api/health`.

For production, point `DATABASE_URL` at a managed database and drop the `db`
service.

---

## Manual deployment

```bash
npm ci
npm run build

npm run db:migrate          # forward-only, recorded in _migrations

npm start                   # process 1: the app  (PORT, default 3000)
npm run worker              # process 2: the worker
```

Run both under a supervisor (systemd, PM2, Kubernetes Deployment). The worker
handles `SIGINT`/`SIGTERM` by finishing its current job and exiting.

### systemd sketch

```ini
# /etc/systemd/system/rasd.service
[Service]
WorkingDirectory=/srv/rasd
EnvironmentFile=/etc/rasd/env
ExecStart=/usr/bin/npm start
Restart=always
User=rasd

# /etc/systemd/system/rasd-worker.service
[Service]
WorkingDirectory=/srv/rasd
EnvironmentFile=/etc/rasd/env
ExecStart=/usr/bin/npm run worker
Restart=always
User=rasd
```

---

## Reverse proxy

Terminate TLS upstream and forward the client address, or rate limiting and the
audit trail record the proxy's IP:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 30M;          # must exceed MAX_UPLOAD_BYTES
}
```

Security headers come from the app (`next.config.mjs`); do not strip them.

---

## Scheduled work

Nothing schedules itself. Enqueue the deadline sweep from cron:

```bash
# daily at 06:00 — deadline reminders and expiring-document alerts
0 6 * * * psql "$DATABASE_URL" -c \
  "INSERT INTO jobs (org_id, type) SELECT id, 'DEADLINE_SWEEP' FROM organizations"
```

Periodic discovery is the same shape with `'DISCOVER_TENDERS'`. Insert per
organization, since jobs are tenant-scoped.

---

## Scaling

- **App**: stateless; scale horizontally. Note that rate limiting is in-process
  memory, so the effective limit multiplies by the replica count — move it to
  Redis or Postgres first (see LIMITATIONS.md).
- **Worker**: scale horizontally. `FOR UPDATE SKIP LOCKED` prevents two workers
  claiming one job.
- **Database**: the pool defaults to 10 connections per app process. Account for
  `app_replicas × 10 + worker_replicas × 10` against your database's limit.
- **Uploads**: local disk is per-container. With more than one app replica,
  implement S3 or mount shared storage, or a download will 404 depending on which
  replica serves it.

---

## Health and observability

- `GET /api/health` — runs a real `SELECT 1`, reports database state and the
  state of each integration. Returns 503 when the database is unreachable, so it
  is usable as a readiness probe.
- Logs are single-line JSON with `t`, `level`, `msg` and context, redacting any
  key matching `password|secret|token|api_key|authorization|cookie|hash`. Ship
  stdout to your log platform.
- Every HTTP response carries `x-request-id`, which appears in the log line for
  that request.
- `audit_logs` is the user-facing trail; `agent_runs` and `agent_steps` are the
  execution trail. The Activity and Agent Execution reports read both.

## Backups

Back up the database **and** the uploads directory — a document in storage with
no row is unreachable, and a row with no file breaks downloads. Both are needed
to restore an analysis's evidence chain.

```bash
pg_dump "$DATABASE_URL" | gzip > rasd-$(date +%F).sql.gz
tar czf rasd-storage-$(date +%F).tar.gz "$STORAGE_LOCAL_DIR"
```

## Upgrading

```bash
git pull && npm ci && npm run build
npm run db:migrate        # applies only new files
# restart app, then worker
```

Migrations are forward-only; there are no down migrations. Write a new file
rather than editing an applied one — the migrator records applied names and will
skip a file it has already run, so an edit silently does nothing.

## First-run checklist

1. `GET /api/health` → `status: ok`, `database: up`.
2. `integrations.ai` → `CONNECTED`. If `NOT_CONFIGURED`, agents will not run.
3. `ENABLE_DEMO_PROVIDER=false`.
4. Register a workspace, complete and confirm the company profile, upload one
   document and confirm the extracted character count is non-zero.
5. Run one analysis end to end and read `/app/agents/<id>` — the step log is
   where you see whether the agents are actually doing the work.
6. Approve a draft and export it, to confirm the approval gate and the download.
