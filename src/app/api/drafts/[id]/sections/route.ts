import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { updateSection } from '@/server/drafts';

const input = z.object({
  sectionId: z.string().uuid(),
  body: z.string().max(40_000),
  heading: z.string().min(2).max(300).optional(),
});

export const PATCH = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const { sectionId, body: text, heading } = await body(req, input);
  await updateSection(ctx, sectionId, text, heading);
  return ok({ saved: true, note: 'Editing an approved draft reopens it for review.' });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
