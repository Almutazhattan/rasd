/**
 * Provider registry and the discovery flow.
 *
 * Records are upserted per workspace, keyed by (org, source, sourceRef).
 * Changed fields on an existing tender are written to tender_changes so the
 * amendment history the business needs is captured rather than overwritten.
 */
import { scoped, type Ctx } from '@/lib/tenancy';
import { audit } from '@/lib/audit';
import { notify } from '../notifications';
import { logger } from '@/lib/logger';
import { assertCan } from '@/lib/rbac';
import { EtimadProvider } from './etimad';
import { DemoProvider } from './demo';
import type { DiscoveryQuery, NormalizedTender, ProcurementProvider } from './types';

export type { DiscoveryQuery, NormalizedTender } from './types';

const PROVIDERS: ProcurementProvider[] = [new EtimadProvider(), new DemoProvider()];

export function providers(): ProcurementProvider[] {
  return PROVIDERS;
}

export function providerStates() {
  return PROVIDERS.map((p) => ({
    key: p.key, label: p.label, state: p.state(), isDemo: p.isDemo, verification: p.verification,
  }));
}

export interface DiscoverOutcome {
  imported: number;
  updated: number;
  skipped: number;
  notes: { provider: string; state: string; note: string | null }[];
}

export async function discover(ctx: Ctx, query: DiscoveryQuery = {}): Promise<DiscoverOutcome> {
  if (!('system' in ctx)) assertCan(ctx.role, 'tender:import');
  const out: DiscoverOutcome = { imported: 0, updated: 0, skipped: 0, notes: [] };

  for (const provider of PROVIDERS) {
    const result = await provider.search(query);
    out.notes.push({ provider: provider.key, state: result.state, note: result.note });
    if (result.state !== 'CONNECTED' || result.tenders.length === 0) continue;

    for (const t of result.tenders) {
      try {
        const written = await upsertTender(ctx, provider, t, result.fetchedAt);
        if (written === 'inserted') out.imported += 1;
        else if (written === 'updated') out.updated += 1;
        else out.skipped += 1;
      } catch (err) {
        out.skipped += 1;
        logger.error('tender upsert failed', {
          provider: provider.key, sourceRef: t.sourceRef,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (out.imported > 0) {
    await notify(ctx, {
      kind: 'NEW_OPPORTUNITY',
      title: `${out.imported} فرصة جديدة`,
      body: 'افتح قائمة الفرص لمراجعتها.',
      link: '/app/opportunities',
    });
  }
  await audit(ctx, 'tender.discover', { type: 'tender' }, {
    imported: out.imported, updated: out.updated, skipped: out.skipped,
  });
  return out;
}

const TRACKED: (keyof NormalizedTender)[] = [
  'title', 'entity', 'status', 'closesAt', 'publishedAt', 'estimatedValueBand',
  'summary', 'scopeOfWork', 'submissionNotes',
];

const COLUMN: Partial<Record<keyof NormalizedTender, string>> = {
  title: 'title', entity: 'entity', status: 'status', closesAt: 'closes_at',
  publishedAt: 'published_at', estimatedValueBand: 'estimated_value_band',
  summary: 'summary', scopeOfWork: 'scope_of_work', submissionNotes: 'submission_notes',
};

async function upsertTender(
  ctx: Ctx, provider: ProcurementProvider, t: NormalizedTender, fetchedAt: Date,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const s = scoped(ctx);
  const existing = (await s
    .from('tenders')
    .selectAll()
    .where('source_name' as never, '=', provider.key as never)
    .where('source_ref' as never, '=', t.sourceRef as never)
    .executeTakeFirst()) as Record<string, unknown> | undefined;

  const values = {
    source_kind: provider.sourceKind,
    source_name: provider.key,
    source_ref: t.sourceRef,
    source_url: t.sourceUrl,
    verification: provider.verification,
    is_demo: provider.isDemo,
    retrieved_at: fetchedAt,
    title: t.title,
    entity: t.entity,
    reference_no: t.referenceNo,
    sector: t.sector,
    region: t.region,
    type: t.type,
    status: t.status,
    published_at: t.publishedAt,
    closes_at: t.closesAt,
    estimated_value_band: t.estimatedValueBand,
    bond_required: t.bondRequired,
    summary: t.summary,
    scope_of_work: t.scopeOfWork,
    submission_notes: t.submissionNotes,
    raw: JSON.stringify(t.raw ?? {}),
  };

  if (!existing) {
    await s.insert('tenders', values).execute();
    return 'inserted';
  }

  const changes: { field: string; before: string | null; after: string | null }[] = [];
  for (const field of TRACKED) {
    const col = COLUMN[field];
    if (!col) continue;
    const before = normalizeValue(existing[col]);
    const after = normalizeValue((values as Record<string, unknown>)[col]);
    if (before !== after) changes.push({ field: col, before, after });
  }

  if (changes.length === 0) {
    await s.update('tenders').set({ retrieved_at: fetchedAt })
      .where('id' as never, '=', existing.id as never).execute();
    return 'unchanged';
  }

  await s.update('tenders').set({ ...values, updated_at: new Date() })
    .where('id' as never, '=', existing.id as never).execute();
  await s.insertMany(
    'tender_changes',
    changes.map((c) => ({ tender_id: existing.id as string, field: c.field, before: c.before, after: c.after })),
  ).execute();
  return 'updated';
}

function normalizeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v).slice(0, 2000);
}
