/**
 * Document pipeline: upload → extract → chunk with page references.
 *
 * Page references are the point. A requirement or a compliance claim is worth
 * little without "which document, which page", so extraction keeps the page
 * boundaries and every chunk carries its page number. When a PDF yields no
 * text — a scan, or a protected file — the document is marked readable = false
 * with a note, and the agents report it as unreadable instead of guessing at
 * its contents.
 */
import { scoped, actorId, type Ctx } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { notify } from './notifications';
import { AppError, notFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { deleteFile, getFile, putFile } from './storage';

const CHUNK_CHARS = 2400;
const CHUNK_OVERLAP = 200;

export interface ExtractResult {
  pageCount: number | null;
  textChars: number;
  chunks: number;
  readable: boolean;
  note: string | null;
}

/** Split page text into overlapping chunks that each remember their page. */
export function chunkPages(pages: string[]): { page: number; ordinal: number; text: string }[] {
  const out: { page: number; ordinal: number; text: string }[] = [];
  let ordinal = 0;
  pages.forEach((raw, index) => {
    const text = raw.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
    if (!text) return;
    if (text.length <= CHUNK_CHARS) {
      out.push({ page: index + 1, ordinal: ordinal++, text });
      return;
    }
    for (let start = 0; start < text.length; start += CHUNK_CHARS - CHUNK_OVERLAP) {
      const slice = text.slice(start, start + CHUNK_CHARS).trim();
      if (slice) out.push({ page: index + 1, ordinal: ordinal++, text: slice });
      if (start + CHUNK_CHARS >= text.length) break;
    }
  });
  return out;
}

/**
 * Extract text per page. pdf-parse is loaded lazily and per page via its
 * pagerender hook, so page boundaries survive into the chunks.
 */
export async function extractPdfPages(bytes: Buffer): Promise<{ pages: string[]; pageCount: number }> {
  const pages: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = (await import('pdf-parse')).default as (
    data: Buffer,
    opts?: { pagerender?: (pageData: unknown) => Promise<string> },
  ) => Promise<{ numpages: number; text: string }>;

  const result = await pdfParse(bytes, {
    async pagerender(pageData: unknown) {
      const page = pageData as { getTextContent: (o: unknown) => Promise<{ items: { str: string }[] }> };
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const text = content.items.map((i) => i.str).join(' ');
      pages.push(text);
      return text;
    },
  });

  return { pages: pages.length ? pages : [result.text ?? ''], pageCount: result.numpages ?? pages.length };
}

async function extractInto(
  ctx: Ctx,
  target: { table: 'company_documents' | 'tender_documents'; id: string; mimeType: string; storageKey: string; title: string },
): Promise<ExtractResult> {
  const s = scoped(ctx);
  const bytes = await getFile(target.storageKey);

  let pages: string[] = [];
  let pageCount: number | null = null;
  let note: string | null = null;

  if (target.mimeType === 'application/pdf') {
    try {
      const res = await extractPdfPages(bytes);
      pages = res.pages;
      pageCount = res.pageCount;
    } catch (err) {
      note = 'تعذّر قراءة ملف PDF — قد يكون محمياً أو تالفاً.';
      logger.warn('pdf extraction failed', {
        documentId: target.id, err: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (target.mimeType === 'text/plain') {
    pages = [bytes.toString('utf8')];
    pageCount = 1;
  } else {
    note =
      `لا يدعم هذا الإصدار استخراج النص من ${target.mimeType}. ` +
      'الملف محفوظ ومتاح للتحميل، لكنه لا يُستخدم كدليل في التحليل.';
  }

  const textChars = pages.join('').trim().length;
  // The character floor guards against a scanned PDF whose extraction yields a
  // few stray glyphs. Plain text has no such artefacts, so any content counts:
  // a short certificate is still a readable document.
  const MIN_CHARS = target.mimeType === 'text/plain' ? 1 : 40;
  const readable = textChars >= MIN_CHARS;
  if (!readable && !note) {
    note =
      'لم يُستخرج نصّ من هذه الوثيقة — غالباً صورة ممسوحة ضوئياً. ' +
      'ستُبلّغ الوكلاء بأنها غير مقروءة ولن تُستنتج محتوياتها.';
  }

  const chunks = readable ? chunkPages(pages) : [];

  await s.delete('document_chunks')
    .where(
      (target.table === 'company_documents' ? 'company_document_id' : 'tender_document_id') as never,
      '=', target.id as never,
    )
    .execute();

  if (chunks.length) {
    const column = target.table === 'company_documents' ? 'company_document_id' : 'tender_document_id';
    await s.insertMany(
      'document_chunks',
      chunks.map((c) => ({
        [column]: target.id, page: c.page, ordinal: c.ordinal,
        text: c.text, char_count: c.text.length,
      })),
    ).execute();
  }

  if (target.table === 'company_documents') {
    await s.update('company_documents')
      .set({ extracted_at: new Date(), text_chars: textChars, page_count: pageCount })
      .where('id' as never, '=', target.id as never).execute();
  } else {
    await s.update('tender_documents')
      .set({ extracted_at: new Date(), page_count: pageCount, readable, note })
      .where('id' as never, '=', target.id as never).execute();
  }

  await audit(ctx, 'document.extract', { type: target.table, id: target.id }, {
    chunks: chunks.length, textChars, readable,
  });

  return { pageCount, textChars, chunks: chunks.length, readable, note };
}

// ────────────────────────────── company documents ──────────────────────────────

export interface UploadInput {
  title: string;
  kind: string;
  mimeType: string;
  bytes: Uint8Array;
  expiresAt?: Date | null;
}

export async function uploadCompanyDocument(ctx: Ctx, input: UploadInput) {
  if (!('system' in ctx)) assertCan(ctx.role, 'document:upload');
  const stored = await putFile(ctx.orgId, input.bytes, input.mimeType, 'company');
  const s = scoped(ctx);

  const row = await s
    .insert('company_documents', {
      uploaded_by_id: actorId(ctx), kind: input.kind, title: input.title.slice(0, 300),
      storage_key: stored.storageKey, mime_type: stored.mimeType, byte_size: stored.byteSize,
      sha256: stored.sha256, expires_at: input.expiresAt ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const id = (row as { id: string }).id;

  await audit(ctx, 'document.upload', { type: 'company_document', id }, {
    kind: input.kind, bytes: stored.byteSize,
  });

  const extraction = await extractInto(ctx, {
    table: 'company_documents', id, mimeType: stored.mimeType,
    storageKey: stored.storageKey, title: input.title,
  });

  return { id, ...extraction };
}

export async function deleteCompanyDocument(ctx: Ctx, id: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'document:delete');
  const s = scoped(ctx);
  const doc = await s.findById('company_documents', id);
  if (!doc) throw notFound('Document not found in this workspace.');
  await s.delete('company_documents').where('id' as never, '=', id as never).execute();
  await deleteFile((doc as { storage_key: string }).storage_key);
  await audit(ctx, 'document.delete', { type: 'company_document', id });
}

export async function listCompanyDocuments(ctx: Ctx) {
  return scoped(ctx)
    .from('company_documents')
    .select(['id', 'kind', 'title', 'mime_type', 'byte_size', 'page_count', 'text_chars',
      'extracted_at', 'expires_at', 'created_at'])
    .orderBy('created_at', 'desc')
    .limit(300)
    .execute();
}

/** Documents expiring inside `days`. Used by the deadline sweep and readiness. */
export async function expiringDocuments(ctx: Ctx, days = 60) {
  const until = new Date(Date.now() + days * 86_400_000);
  return scoped(ctx)
    .from('company_documents')
    .select(['id', 'title', 'kind', 'expires_at'])
    .where('expires_at' as never, 'is not' as never, null as never)
    .where('expires_at' as never, '<=' as never, until as never)
    .orderBy('expires_at')
    .execute();
}

// ────────────────────────────── tender documents ──────────────────────────────

export async function uploadTenderDocument(
  ctx: Ctx, tenderId: string, input: Omit<UploadInput, 'kind' | 'expiresAt'>,
) {
  if (!('system' in ctx)) assertCan(ctx.role, 'tender:import');
  const s = scoped(ctx);
  await s.getById('tenders', tenderId, 'Tender');

  const stored = await putFile(ctx.orgId, input.bytes, input.mimeType, 'tender');
  const row = await s
    .insert('tender_documents', {
      tender_id: tenderId, title: input.title.slice(0, 300), storage_key: stored.storageKey,
      mime_type: stored.mimeType, byte_size: stored.byteSize, sha256: stored.sha256,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const id = (row as { id: string }).id;

  const extraction = await extractInto(ctx, {
    table: 'tender_documents', id, mimeType: stored.mimeType,
    storageKey: stored.storageKey, title: input.title,
  });

  if (!extraction.readable) {
    await notify(ctx, {
      kind: 'MISSING_DOCUMENT',
      title: `وثيقة غير مقروءة: ${input.title.slice(0, 80)}`,
      body: extraction.note ?? undefined,
      link: `/app/opportunities/${tenderId}`,
    });
  }
  return { id, ...extraction };
}

export async function readDocumentForDownload(
  ctx: Ctx, table: 'company_documents' | 'tender_documents', id: string,
) {
  const doc = await scoped(ctx).findById(table, id);
  if (!doc) throw notFound('Document not found in this workspace.');
  const d = doc as { storage_key: string; mime_type: string; title: string };
  const bytes = await getFile(d.storage_key);
  if (!bytes) throw new AppError('NOT_FOUND', 'The stored file is missing.');
  return { bytes, mimeType: d.mime_type, title: d.title };
}
