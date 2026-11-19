import { handler, ok, created } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { listCompanyDocuments, uploadCompanyDocument } from '@/server/documents';
import { AppError } from '@/lib/errors';

export const GET = handler(async () => ok((await listCompanyDocuments(await requireAuth())) as never));

/** multipart/form-data: file, title, kind, expiresAt? */
export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const form = await req.formData().catch(() => {
    throw new AppError('VALIDATION', 'Expected a multipart form upload.');
  });
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('VALIDATION', 'A file is required.');

  const expiresRaw = String(form.get('expiresAt') ?? '').trim();
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new AppError('VALIDATION', 'expiresAt is not a valid date.');
  }

  const result = await uploadCompanyDocument(ctx, {
    title: String(form.get('title') ?? file.name).slice(0, 300),
    kind: String(form.get('kind') ?? 'other').slice(0, 40),
    mimeType: file.type || 'application/octet-stream',
    bytes: new Uint8Array(await file.arrayBuffer()),
    expiresAt,
  });
  return created(result as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
