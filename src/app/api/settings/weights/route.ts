import { z } from 'zod';
import { body, handler, ok } from '@/server/http/handler';
import { requireAuth } from '@/server/http/context';
import { loadWeights, updateWeights } from '@/server/analysis';
import { DIMENSION_LABELS } from '@/lib/scoring';

const weight = z.number().int().min(0).max(100);
const input = z.object({
  technicalFit: weight, experience: weight, complianceReadiness: weight,
  resources: weight, financialReadiness: weight, geographic: weight,
});

export const GET = handler(async () => {
  const ctx = await requireAuth();
  return ok({ weights: await loadWeights(ctx), labels: DIMENSION_LABELS } as never);
});

export const PUT = handler(async (req: Request) => {
  const ctx = await requireAuth();
  const weights = await body(req, input);
  await updateWeights(ctx, weights);
  return ok({ weights } as never);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
