/**
 * Password hashing: scrypt from node:crypto — no native build step, and the
 * parameters below are the OWASP-recommended floor (N=2^16, r=8, p=1).
 * Format: scrypt$N$r$p$salt_b64$hash_b64 — self-describing, so parameters can
 * be raised later without invalidating existing hashes.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  pw: string | Buffer, salt: Buffer, len: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OpenSSL's default maxmem (32 MiB) is below what N=2^16, r=8 needs (64 MiB). */
const maxmem = (n: number, r: number) => 128 * n * r * 2;

const N = 65_536;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const PASSWORD_MIN = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < PASSWORD_MIN) {
    throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
  }
  const salt = randomBytes(16);
  const key = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  const kN = Number(n);
  const kR = Number(r);
  if (!Number.isFinite(kN) || !Number.isFinite(kR)) return false;
  const key = await scrypt(plain.normalize('NFKC'), salt, expected.length, {
    N: kN, r: kR, p: Number(p), maxmem: maxmem(kN, kR),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** True when a hash was made with weaker parameters and should be upgraded on next login. */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$');
  return Number(n) < N || Number(r) < R || Number(p) < P;
}
