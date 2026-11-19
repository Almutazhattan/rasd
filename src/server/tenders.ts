/**
 * Tender search, filtering and comparison.
 *
 * Search runs in SQL against stored records. Filters are built from a
 * validated query object, so a malformed filter is rejected rather than
 * silently ignored — a search that quietly drops a filter is worse than one
 * that refuses it.
 */
import { z } from 'zod';
import { scoped, type Ctx } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

export const searchInput = z.object({
  q: z.string().max(200).optional(),
  entity: z.string().max(200).optional(),
  sector: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  status: z.enum(['OPEN', 'CLOSING_SOON', 'CLOSED', 'CANCELLED', 'AWARDED', 'UNKNOWN']).optional(),
  type: z.string().max(120).optional(),
  publishedAfter: z.coerce.date().optional(),
  closesBefore: z.coerce.date().optional(),
  bookmarkedOnly: z.coerce.boolean().optional(),
  includeDemo: z.coerce.boolean().default(true),
  sort: z.enum(['closing', 'published', 'title', 'score']).default('closing'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type SearchInput = z.infer<typeof searchInput>;

export async function searchTenders(ctx: Ctx, raw: unknown) {
  const input = searchInput.parse(raw ?? {});
  const s = scoped(ctx);

  const build = () => {
    let q = s.from('tenders');
    if (input.q) {
      const like = `%${input.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('tenders.title' as never, 'ilike' as never, like as never),
          eb('tenders.summary' as never, 'ilike' as never, like as never),
          eb('tenders.scope_of_work' as never, 'ilike' as never, like as never),
          eb('tenders.entity' as never, 'ilike' as never, like as never),
          eb('tenders.reference_no' as never, 'ilike' as never, like as never),
        ]),
      );
    }
    if (input.entity) q = q.where('entity' as never, 'ilike' as never, `%${input.entity}%` as never);
    if (input.sector) q = q.where('sector' as never, '=' as never, input.sector as never);
    if (input.region) q = q.where('region' as never, '=' as never, input.region as never);
    if (input.status) q = q.where('status' as never, '=' as never, input.status as never);
    if (input.type) q = q.where('type' as never, '=' as never, input.type as never);
    if (input.publishedAfter) q = q.where('published_at' as never, '>=' as never, input.publishedAfter as never);
    if (input.closesBefore) q = q.where('closes_at' as never, '<=' as never, input.closesBefore as never);
    if (!input.includeDemo) q = q.where('is_demo' as never, '=' as never, false as never);
    if (input.bookmarkedOnly) {
      q = q.where((eb) =>
        eb.exists(
          eb.selectFrom('bookmarks')
            .select('bookmarks.id')
            .whereRef('bookmarks.tender_id', '=', 'tenders.id')
            .where('bookmarks.org_id', '=', ctx.orgId),
        ),
      );
    }
    return q;
  };

  const totalRow = await build().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
  const total = Number((totalRow as { n?: string } | undefined)?.n ?? 0);

  let rows = build().select([
    'id', 'title', 'entity', 'reference_no', 'sector', 'region', 'type', 'status',
    'published_at', 'closes_at', 'estimated_value_band', 'bond_required',
    'source_name', 'source_kind', 'verification', 'is_demo', 'summary', 'retrieved_at',
  ]);

  switch (input.sort) {
    case 'published': rows = rows.orderBy('published_at', 'desc'); break;
    case 'title': rows = rows.orderBy('title'); break;
    case 'score': rows = rows.orderBy('closes_at'); break; // score lives on analyses
    default: rows = rows.orderBy('closes_at');
  }

  const items = await rows
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize)
    .execute();

  return {
    items, total, page: input.page, pageSize: input.pageSize,
    pages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function facets(ctx: Ctx) {
  const s = scoped(ctx);
  const pick = async (column: 'sector' | 'region' | 'type' | 'entity') => {
    const rows = await s.from('tenders')
      .select(column as never)
      .distinct()
      .where(column as never, 'is not' as never, null as never)
      .limit(120)
      .execute();
    return (rows as Record<string, string>[]).map((r) => r[column]).filter(Boolean).sort();
  };
  const [sectors, regions, types, entities] = await Promise.all([
    pick('sector'), pick('region'), pick('type'), pick('entity'),
  ]);
  return { sectors, regions, types, entities };
}

export async function getTender(ctx: Ctx, tenderId: string) {
  const s = scoped(ctx);
  const tender = await s.findById('tenders', tenderId);
  if (!tender) throw notFound('Tender not found in this workspace.');
  const [documents, requirements, changes, qa, analyses, bookmark] = await Promise.all([
    s.from('tender_documents')
      .select(['id', 'title', 'mime_type', 'byte_size', 'page_count', 'readable', 'note', 'extracted_at', 'created_at'])
      .where('tender_id' as never, '=', tenderId as never).orderBy('created_at').execute(),
    s.from('tender_requirements')
      .select(['id', 'category', 'mandatory', 'text', 'doc_ref', 'page_ref', 'provenance', 'confidence'])
      .where('tender_id' as never, '=', tenderId as never).orderBy('category').execute(),
    s.from('tender_changes').select(['field', 'before', 'after', 'noticed_at'])
      .where('tender_id' as never, '=', tenderId as never).orderBy('noticed_at', 'desc').limit(50).execute(),
    s.from('tender_qa').select(['question', 'answer', 'asked_at', 'source_ref'])
      .where('tender_id' as never, '=', tenderId as never).execute(),
    s.from('analyses')
      .select(['id', 'status', 'score', 'verdict', 'blocking_gaps', 'created_at', 'finished_at'])
      .where('tender_id' as never, '=', tenderId as never).orderBy('created_at', 'desc').execute(),
    s.from('bookmarks').select('id').where('tender_id' as never, '=', tenderId as never).executeTakeFirst(),
  ]);
  return { tender, documents, requirements, changes, qa, analyses, bookmarked: Boolean(bookmark) };
}

export const manualTenderInput = z.object({
  title: z.string().min(3).max(300),
  entity: z.string().min(2).max(200),
  referenceNo: z.string().max(120).optional().nullable(),
  sector: z.string().max(120).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  type: z.string().max(120).optional().nullable(),
  closesAt: z.coerce.date().optional().nullable(),
  publishedAt: z.coerce.date().optional().nullable(),
  estimatedValueBand: z.string().max(60).optional().nullable(),
  sourceUrl: z.string().url().max(500).optional().nullable(),
  summary: z.string().max(4000).optional().nullable(),
  scopeOfWork: z.string().max(20000).optional().nullable(),
  submissionNotes: z.string().max(4000).optional().nullable(),
});

/**
 * Add a tender by hand — the path for a notice a user has in front of them.
 * It is stored as MANUAL/UNVERIFIED: entered by a person, not confirmed
 * against an official source, and labelled that way everywhere.
 */
export async function addManualTender(ctx: Ctx, raw: unknown) {
  if (!('system' in ctx)) assertCan(ctx.role, 'tender:import');
  const input = manualTenderInput.parse(raw);
  const row = await scoped(ctx)
    .insert('tenders', {
      source_kind: 'MANUAL', source_name: 'manual',
      source_ref: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source_url: input.sourceUrl ?? null, verification: 'UNVERIFIED', is_demo: false,
      retrieved_at: new Date(), title: input.title, entity: input.entity,
      reference_no: input.referenceNo ?? null, sector: input.sector ?? null,
      region: input.region ?? null, type: input.type ?? null,
      status: input.closesAt && input.closesAt.getTime() < Date.now() ? 'CLOSED' : 'OPEN',
      published_at: input.publishedAt ?? null, closes_at: input.closesAt ?? null,
      estimated_value_band: input.estimatedValueBand ?? null, summary: input.summary ?? null,
      scope_of_work: input.scopeOfWork ?? null, submission_notes: input.submissionNotes ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const id = (row as { id: string }).id;
  await audit(ctx, 'tender.import', { type: 'tender', id }, { manual: true });
  return id;
}

export async function toggleBookmark(ctx: Ctx, tenderId: string) {
  const s = scoped(ctx);
  await s.getById('tenders', tenderId, 'Tender');
  const existing = await s.from('bookmarks').select('id')
    .where('tender_id' as never, '=', tenderId as never).executeTakeFirst();
  if (existing) {
    await s.delete('bookmarks').where('tender_id' as never, '=', tenderId as never).execute();
    return false;
  }
  await s.insert('bookmarks', { tender_id: tenderId }).execute();
  await audit(ctx, 'tender.bookmark', { type: 'tender', id: tenderId });
  return true;
}

export async function deleteTender(ctx: Ctx, tenderId: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'tender:delete');
  await scoped(ctx).delete('tenders').where('id' as never, '=', tenderId as never).execute();
  await audit(ctx, 'tender.delete', { type: 'tender', id: tenderId });
}

export const savedSearchInput = z.object({
  name: z.string().min(2).max(120),
  query: searchInput.partial(),
  alertActive: z.boolean().default(false),
});

export async function saveSearch(ctx: Ctx, raw: unknown) {
  const input = savedSearchInput.parse(raw);
  const row = await scoped(ctx)
    .insert('saved_searches', {
      name: input.name, query: JSON.stringify(input.query), alert_active: input.alertActive,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return (row as { id: string }).id;
}

export async function listSavedSearches(ctx: Ctx) {
  return scoped(ctx)
    .from('saved_searches')
    .select(['id', 'name', 'query', 'alert_active', 'last_run_at', 'created_at'])
    .orderBy('created_at', 'desc')
    .execute();
}

/** Side-by-side comparison of up to six tenders with their latest analysis. */
export async function compareTenders(ctx: Ctx, tenderIds: string[]) {
  const ids = tenderIds.slice(0, 6);
  if (ids.length === 0) return [];
  const s = scoped(ctx);
  const tenders = (await s
    .from('tenders')
    .select(['id', 'title', 'entity', 'sector', 'region', 'closes_at', 'estimated_value_band',
      'bond_required', 'status', 'is_demo'])
    .where('id' as never, 'in' as never, ids as never)
    .execute()) as Record<string, unknown>[];

  const analyses = (await s
    .from('analyses')
    .select(['id', 'tender_id', 'score', 'verdict', 'blocking_gaps', 'confidence', 'status', 'finished_at'])
    .where('tender_id' as never, 'in' as never, ids as never)
    .orderBy('created_at', 'desc')
    .execute()) as Record<string, unknown>[];

  return tenders.map((t) => ({
    tender: t,
    analysis: analyses.find((a) => a.tender_id === t.id) ?? null,
  }));
}
