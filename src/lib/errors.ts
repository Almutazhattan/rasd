/**
 * Error taxonomy. `publicMessage` is the only text ever returned to a client;
 * internal detail stays in the log. This is what keeps stack traces, SQL and
 * provider responses out of HTTP responses.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT'
  | 'RATE_LIMITED' | 'PROVIDER_UNCONFIGURED' | 'PROVIDER_ERROR' | 'TIMEOUT'
  | 'UNSUPPORTED_FILE' | 'FILE_TOO_LARGE' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVIDER_UNCONFIGURED: 503,
  PROVIDER_ERROR: 502,
  TIMEOUT: 504,
  UNSUPPORTED_FILE: 415,
  FILE_TOO_LARGE: 413,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: ErrorCode, publicMessage: string, detail?: Record<string, unknown>) {
    super(`${code}: ${publicMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = publicMessage;
    this.detail = detail;
  }
}

export const unauthenticated = (m = 'Sign in required.') => new AppError('UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have permission to do this.') => new AppError('FORBIDDEN', m);
export const notFound = (m = 'Not found.') => new AppError('NOT_FOUND', m);
export const validation = (m: string, detail?: Record<string, unknown>) =>
  new AppError('VALIDATION', m, detail);
export const conflict = (m: string) => new AppError('CONFLICT', m);
export const providerUnconfigured = (m: string) => new AppError('PROVIDER_UNCONFIGURED', m);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
