/**
 * Validated environment. Imported on the server only — never from a client
 * component. Missing required values fail fast at boot with a readable error
 * instead of surfacing as a runtime 500 later.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  /** Which model provider runs the agents: anthropic | gemini | groq | none. */
  AI_PROVIDER: z.enum(['anthropic', 'gemini', 'groq', 'none']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  ETIMAD_API_BASE: z.string().optional(),
  ETIMAD_API_KEY: z.string().optional(),
  ENABLE_DEMO_PROVIDER: z.enum(['true', 'false']).default('true'),

  STORAGE_DRIVER: z.enum(['local', 's3', 'blob']).default('local'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('RASD <no-reply@rasd.local>'),

  APP_URL: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  /** Bearer secret for /api/cron/jobs (Vercel Cron sends it automatically). */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}\n\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the cache. Tests only. */
export function __resetEnv() {
  cached = null;
}

/**
 * Integration readiness. The UI renders these states literally — a feature
 * whose dependency is absent says so rather than pretending to work.
 */
export type IntegrationState = 'CONNECTED' | 'NOT_CONFIGURED' | 'DEMO' | 'DISABLED';

/** The API key the selected provider needs, by variable name. */
export function aiKeyName(e: Env = env()): string {
  return e.AI_PROVIDER === 'gemini' ? 'GEMINI_API_KEY'
    : e.AI_PROVIDER === 'groq' ? 'GROQ_API_KEY'
    : 'ANTHROPIC_API_KEY';
}

/** The model the selected provider will use. */
export function aiModel(e: Env = env()): string {
  return e.AI_PROVIDER === 'gemini' ? e.GEMINI_MODEL
    : e.AI_PROVIDER === 'groq' ? e.GROQ_MODEL
    : e.ANTHROPIC_MODEL;
}

export function aiState(e: Env = env()): IntegrationState {
  if (e.AI_PROVIDER === 'none') return 'DISABLED';
  const key = e.AI_PROVIDER === 'gemini' ? e.GEMINI_API_KEY
    : e.AI_PROVIDER === 'groq' ? e.GROQ_API_KEY
    : e.ANTHROPIC_API_KEY;
  return key && key.length > 10 ? 'CONNECTED' : 'NOT_CONFIGURED';
}

export function etimadState(e: Env = env()): IntegrationState {
  return e.ETIMAD_API_BASE && e.ETIMAD_API_KEY ? 'CONNECTED' : 'NOT_CONFIGURED';
}

export function demoState(e: Env = env()): IntegrationState {
  return e.ENABLE_DEMO_PROVIDER === 'true' ? 'DEMO' : 'DISABLED';
}

export function mailState(e: Env = env()): IntegrationState {
  return e.SMTP_URL ? 'CONNECTED' : 'NOT_CONFIGURED';
}
