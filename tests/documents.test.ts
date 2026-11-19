/**
 * Document pipeline: upload validation, page-aware chunking, and the honest
 * handling of a file whose text cannot be extracted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { register } from '@/server/accounts';
import { scoped, type AuthContext } from '@/lib/tenancy';
import { chunkPages, uploadCompanyDocument, listCompanyDocuments, expiringDocuments } from '@/server/documents';
import { assertUploadAcceptable, sniff } from '@/server/storage';
import { __resetEnv } from '@/lib/env';

let ctx: AuthContext;

const PDF_HEADER = Buffer.from('%PDF-1.4\n');
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  await resetDatabase();
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = '/tmp/rasd-test-storage';
  const r = await register({
    name: 'Doc Owner', email: 'owner@docs.test', password: 'a-long-password-1', orgName: 'Docs Org',
  });
  ctx = { userId: r.userId, orgId: r.orgId, role: 'OWNER', email: 'owner@docs.test', name: 'Doc Owner' };
});
afterAll(teardown);

describe('upload validation', () => {
  it('recognizes file types from their bytes, not their name', () => {
    expect(sniff(PDF_HEADER)).toBe('application/pdf');
    expect(sniff(PNG_HEADER)).toBe('image/png');
    expect(sniff(Buffer.from('just text'))).toBeNull();
  });

  it('rejects an empty file', () => {
    expect(() => assertUploadAcceptable('application/pdf', new Uint8Array(0)))
      .toThrowError(/empty/i);
  });

  it('rejects a disallowed type', () => {
    expect(() => assertUploadAcceptable('application/x-sh', Buffer.from('#!/bin/sh')))
      .toThrowError(/not an accepted file type/i);
  });

  it('rejects content that contradicts its declared type', () => {
    // Claims to be a PDF, but the bytes are a PNG.
    expect(() => assertUploadAcceptable('application/pdf', PNG_HEADER))
      .toThrowError(/does not match its declared type/i);
  });

  it('rejects a file over the size limit', () => {
    // env() caches at first read — as it should in production — so the cache is
    // reset explicitly here rather than pretending the limit is hot-reloadable.
    process.env.MAX_UPLOAD_BYTES = '100';
    __resetEnv();
    const big = Buffer.concat([PDF_HEADER, Buffer.alloc(500, 0x20)]);
    expect(() => assertUploadAcceptable('application/pdf', big)).toThrowError(/MB or smaller/i);
    delete process.env.MAX_UPLOAD_BYTES;
    __resetEnv();
  });
});

describe('chunkPages', () => {
  it('keeps each chunk with its page number, counting from one', () => {
    const chunks = chunkPages(['first page text', 'second page text']);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ page: 1, ordinal: 0 });
    expect(chunks[1]).toMatchObject({ page: 2, ordinal: 1 });
  });

  it('skips blank pages without losing the numbering of the rest', () => {
    const chunks = chunkPages(['alpha', '   ', '', 'delta']);
    expect(chunks.map((c) => c.page)).toEqual([1, 4]);
    expect(chunks.map((c) => c.text)).toEqual(['alpha', 'delta']);
  });

  it('splits a long page into overlapping chunks that all keep the page number', () => {
    const long = 'ا'.repeat(7000);
    const chunks = chunkPages([long]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1]));
    expect(chunks.every((c) => c.text.length <= 2400)).toBe(true);
    // Ordinals are contiguous, so retrieval can order passages.
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('strips null bytes, which Postgres text columns reject', () => {
    const chunks = chunkPages([`clean\u0000text`]);
    expect(chunks[0]!.text).toBe('cleantext');
  });
});

describe('uploadCompanyDocument', () => {
  it('stores a text file, extracts it, and makes it citable', async () => {
    const content = 'شهادة أيزو 27001 سارية حتى 2027. رقم الشهادة ABC-123.';
    const result = await uploadCompanyDocument(ctx, {
      title: 'شهادة أيزو', kind: 'iso', mimeType: 'text/plain', bytes: Buffer.from(content, 'utf8'),
      expiresAt: new Date(Date.now() + 40 * 86_400_000),
    });

    expect(result.readable).toBe(true);
    expect(result.chunks).toBe(1);
    expect(result.textChars).toBeGreaterThan(20);

    const chunks = await scoped(ctx).from('document_chunks').selectAll()
      .where('company_document_id' as never, '=', result.id as never).execute();
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as { text: string }).text).toContain('27001');
    expect((chunks[0] as { page: number }).page).toBe(1);
  });

  it('marks a file with no extractable text as unreadable, and says why', async () => {
    // A PDF header with no text stream: structurally a PDF, no text in it.
    const result = await uploadCompanyDocument(ctx, {
      title: 'مستند ممسوح ضوئياً', kind: 'other', mimeType: 'application/pdf',
      bytes: Buffer.concat([PDF_HEADER, Buffer.alloc(200, 0x20)]),
    });

    expect(result.readable).toBe(false);
    expect(result.chunks).toBe(0);
    expect(result.note).toBeTruthy();

    const docs = (await listCompanyDocuments(ctx)) as { id: string; text_chars: number | null }[];
    const stored = docs.find((d) => d.id === result.id);
    expect(Number(stored?.text_chars ?? 0)).toBeLessThan(41);
  });

  it('reports a type it cannot extract rather than pretending to read it', async () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100, 0x41)]);
    const result = await uploadCompanyDocument(ctx, {
      title: 'ملف وورد', kind: 'other',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx,
    });
    expect(result.readable).toBe(false);
    expect(result.note).toMatch(/لا يدعم هذا الإصدار/);
  });

  it('lists documents expiring within the window, and not others', async () => {
    await uploadCompanyDocument(ctx, {
      title: 'شهادة بعيدة', kind: 'other', mimeType: 'text/plain',
      bytes: Buffer.from('far future certificate'),
      expiresAt: new Date(Date.now() + 400 * 86_400_000),
    });
    const soon = (await expiringDocuments(ctx, 60)) as { title: string }[];
    expect(soon.some((d) => d.title === 'شهادة أيزو')).toBe(true);
    expect(soon.some((d) => d.title === 'شهادة بعيدة')).toBe(false);
  });

  it('refuses the upload for a role without the permission', async () => {
    await expect(
      uploadCompanyDocument({ ...ctx, role: 'MEMBER' }, {
        title: 'ممنوع', kind: 'other', mimeType: 'text/plain', bytes: Buffer.from('nope'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
