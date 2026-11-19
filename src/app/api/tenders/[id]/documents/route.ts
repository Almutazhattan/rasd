import { created, handler } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { uploadTenderDocument } from '@/server/documents';
import { AppError } from '@/lib/errors';

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const form = await req.formData().catch(() => {
    throw new AppError('VALIDATION', 'Expected a multipart form upload.');
  });
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('VALIDATION', 'A file is required.');

  const result = await uploadTenderDocument(ctx, params.id, {
    title: String(form.get('title') ?? file.name).slice(0, 300),
    mimeType: file.type || 'application/octet-stream',
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return created(result as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
