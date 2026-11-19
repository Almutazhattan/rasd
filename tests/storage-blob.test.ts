/**
 * The Vercel Blob storage driver. The SDK is replaced with an in-memory store
 * so the test checks what the driver asks for — private access, the generated
 * key, no random suffix — without network access.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const store = new Map<string, { bytes: Buffer; access: string; contentType?: string }>();

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname: string, body: Buffer, opts: { access: string; contentType?: string }) => {
    store.set(pathname, { bytes: Buffer.from(body), access: opts.access, contentType: opts.contentType });
    return { pathname, url: `https://store.private.blob.vercel-storage.com/${pathname}` };
  }),
  get: vi.fn(async (pathname: string) => {
    const hit = store.get(pathname);
    if (!hit) return null;
    return { statusCode: 200, stream: new Blob([new Uint8Array(hit.bytes)]).stream(), blob: { contentType: hit.contentType } };
  }),
  del: vi.fn(async (pathname: string) => { store.delete(pathname); }),
}));

import { __resetEnv } from '@/lib/env';
import { deleteFile, getFile, putFile } from '@/server/storage';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://unused';
  process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
  process.env.STORAGE_DRIVER = 'blob';
  __resetEnv();
});

afterAll(() => {
  delete process.env.STORAGE_DRIVER;
  __resetEnv();
});

describe('blob storage driver', () => {
  it('stores privately under the generated, org-scoped key and reads it back', async () => {
    const stored = await putFile('org-123', PDF, 'application/pdf');
    expect(stored.storageKey).toMatch(/^org-123\/doc\/[0-9a-f-]{36}\.pdf$/);
    expect(store.get(stored.storageKey)?.access).toBe('private');

    const back = await getFile(stored.storageKey);
    expect(Buffer.compare(back, Buffer.from(PDF))).toBe(0);
  });

  it('still validates uploads before anything is stored', async () => {
    const before = store.size;
    await expect(putFile('org-123', new Uint8Array([1, 2, 3]), 'application/pdf')).rejects.toThrow();
    expect(store.size).toBe(before);
  });

  it('a missing blob is NOT_FOUND, and delete is idempotent', async () => {
    const stored = await putFile('org-123', PDF, 'application/pdf');
    await deleteFile(stored.storageKey);
    await deleteFile(stored.storageKey);
    await expect(getFile(stored.storageKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
