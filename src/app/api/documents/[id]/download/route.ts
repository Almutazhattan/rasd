import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, query } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { readDocumentForDownload } from '@/server/documents';

/**
 * Files are never served from a public path: this handler re-checks the
 * session and the workspace before it reads a byte.
 */
export const GET = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const { kind } = query(req, z.object({ kind: z.enum(['company', 'tender']).default('company') }));
  const table = kind === 'tender' ? 'tender_documents' : 'company_documents';
  const file = await readDocumentForDownload(ctx, table, params.id);

  return new NextResponse(file.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.title)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
