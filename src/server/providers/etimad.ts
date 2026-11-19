/**
 * Etimad (اعتماد) — the Saudi government procurement platform.
 *
 * Etimad does not publish an open self-service API. Access is granted under a
 * commercial or governmental agreement, and the base URL and credentials are
 * deployment-specific; see docs/INTEGRATIONS.md for what to request and which
 * variables to set.
 *
 * Consequently this adapter is written against the documented shape but is
 * UNVERIFIED: it has never been executed against the live service from this
 * repository. It therefore does two things and no third:
 *   • when ETIMAD_API_BASE and ETIMAD_API_KEY are absent, it reports
 *     NOT_CONFIGURED and returns nothing;
 *   • when they are present, it calls the endpoint and maps the response,
 *     surfacing any transport or shape error rather than smoothing it over.
 *
 * It never returns an invented tender, and the response mapper rejects records
 * that lack an identifier, a title or an entity instead of filling them in.
 */
import { z } from 'zod';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import type {
  DiscoveryQuery, DiscoveryResult, NormalizedTender, ProcurementProvider, ProviderState,
} from './types';
import type { TenderStatus } from '@/lib/db/types';

/** Defensive: unknown keys are ignored, required keys are required. */
const recordSchema = z.object({
  tenderId: z.union([z.string(), z.number()]).transform(String),
  tenderName: z.string().min(1),
  agencyName: z.string().min(1),
  referenceNumber: z.union([z.string(), z.number()]).transform(String).nullish(),
  tenderActivityName: z.string().nullish(),
  branchName: z.string().nullish(),
  tenderTypeName: z.string().nullish(),
  tenderStatusName: z.string().nullish(),
  submitionDate: z.string().nullish(),
  lastOfferPresentationDate: z.string().nullish(),
  conditionalBookletPrice: z.union([z.string(), z.number()]).nullish(),
  tenderDescription: z.string().nullish(),
  url: z.string().nullish(),
}).passthrough();

const responseSchema = z.object({
  data: z.array(recordSchema).default([]),
  total: z.number().optional(),
}).passthrough();

function mapStatus(raw: string | null | undefined): TenderStatus {
  const s = (raw ?? '').trim();
  if (!s) return 'UNKNOWN';
  if (/ملغ|cancel/i.test(s)) return 'CANCELLED';
  if (/ترسية|award/i.test(s)) return 'AWARDED';
  if (/مغلق|closed/i.test(s)) return 'CLOSED';
  if (/قائم|open|منشور/i.test(s)) return 'OPEN';
  return 'UNKNOWN';
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class EtimadProvider implements ProcurementProvider {
  readonly key = 'etimad';
  readonly label = { ar: 'منصة اعتماد', en: 'Etimad' };
  readonly sourceKind = 'OFFICIAL_API' as const;
  readonly verification = 'VERIFIED_SOURCE' as const;
  readonly isDemo = false;

  state(): ProviderState {
    const e = env();
    return e.ETIMAD_API_BASE && e.ETIMAD_API_KEY ? 'CONNECTED' : 'NOT_CONFIGURED';
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const e = env();
    if (this.state() !== 'CONNECTED') {
      return {
        state: 'NOT_CONFIGURED',
        tenders: [],
        note:
          'التكامل مع منصة اعتماد غير مُهيّأ في هذا النشر. يتطلب الوصول اتفاقية ومفاتيح ' +
          'رسمية — راجع docs/INTEGRATIONS.md. لم تُسترجع أي منافسة، ولم تُستبدل ببيانات أخرى.',
        fetchedAt: new Date(),
      };
    }

    const url = new URL('/api/tenders/search', e.ETIMAD_API_BASE);
    url.searchParams.set('pageSize', String(Math.min(query.limit ?? 50, 200)));
    if (query.keywords?.length) url.searchParams.set('q', query.keywords.join(' '));
    if (query.sectors?.length) url.searchParams.set('activity', query.sectors.join(','));
    if (query.regions?.length) url.searchParams.set('branch', query.regions.join(','));
    if (query.publishedAfter) url.searchParams.set('from', query.publishedAfter.toISOString().slice(0, 10));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${e.ETIMAD_API_KEY}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        // A failed call is reported as a failed call.
        const body = (await res.text()).slice(0, 400);
        logger.error('etimad request failed', { status: res.status });
        return {
          state: 'CONNECTED',
          tenders: [],
          note: `استجابة غير متوقعة من منصة اعتماد (HTTP ${res.status}). ${body}`,
          fetchedAt: new Date(),
        };
      }
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) {
        logger.error('etimad response shape unexpected', { issues: parsed.error.issues.length });
        return {
          state: 'CONNECTED',
          tenders: [],
          note:
            'استجابة منصة اعتماد لا تطابق الشكل المتوقع، فلم تُستورد أي سجلات. ' +
            'راجع docs/INTEGRATIONS.md لتحديث المُحوِّل.',
          fetchedAt: new Date(),
        };
      }

      const tenders: NormalizedTender[] = parsed.data.data.map((r) => ({
        sourceRef: r.tenderId,
        sourceUrl: r.url ?? null,
        title: r.tenderName,
        entity: r.agencyName,
        referenceNo: r.referenceNumber ?? null,
        sector: r.tenderActivityName ?? null,
        region: r.branchName ?? null,
        type: r.tenderTypeName ?? null,
        status: mapStatus(r.tenderStatusName),
        publishedAt: parseDate(r.submitionDate),
        closesAt: parseDate(r.lastOfferPresentationDate),
        estimatedValueBand: null, // Etimad does not publish an estimate; left absent, not guessed.
        bondRequired: null,
        summary: r.tenderDescription ?? null,
        scopeOfWork: null,
        submissionNotes: null,
        raw: r,
      }));

      return { state: 'CONNECTED', tenders, note: null, fetchedAt: new Date() };
    } catch (err) {
      const aborted = controller.signal.aborted;
      logger.error('etimad call errored', { aborted, err: err instanceof Error ? err.message : String(err) });
      return {
        state: 'CONNECTED',
        tenders: [],
        note: aborted
          ? 'انتهت مهلة الاتصال بمنصة اعتماد قبل وصول استجابة.'
          : 'تعذّر الاتصال بمنصة اعتماد. لم تُسترجع أي منافسة.',
        fetchedAt: new Date(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
