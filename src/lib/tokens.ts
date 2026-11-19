/**
 * Opaque tokens for sessions, invitations and email links.
 *
 * Only an HMAC of a token is stored. A database leak therefore cannot be used
 * to mint a valid session: the attacker would also need SESSION_SECRET.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(token).digest('hex');
}

export function tokensMatch(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
