/**
 * Structured logging with redaction. Secrets, tokens and password hashes must
 * never reach the log: keys matching REDACT are replaced, at any depth.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const REDACT = /(password|secret|token|api[_-]?key|authorization|cookie|hash)/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info') as Level;
  return LEVELS[raw] ?? LEVELS.info;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...(meta ? (scrub(meta) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
};

export const __scrub = scrub;
