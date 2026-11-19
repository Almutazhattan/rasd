import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, query } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { exportDraft } from '@/server/drafts';

/**
 * Export is gated server-side: exportDraft refuses unless the draft is
 * approved AND an EXPORT checkpoint has been approved. RASD does not submit
 * anything — this hands the authorized user a file.
 */
export const GET = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await requireAuth();
  const { format } = query(req, z.object({ format: z.enum(['md', 'html']).default('md') }));
  const file = await exportDraft(ctx, params.id, format);

  return new NextResponse(file.content, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Cache-Control': 'private, no-store',
    },
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
