/**
 * Edge-safe constants.
 *
 * src/middleware.ts runs on the edge runtime, where `node:crypto` cannot be
 * imported. Session logic needs crypto, so the cookie name lives here on its
 * own and both sides import it from the same place — rather than the name being
 * written twice and drifting.
 */
export const SESSION_COOKIE = 'rasd_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
