/**
 * Procurement source provider contract.
 *
 * Adding a source means adding a file here. No agent and no UI code knows
 * which provider produced a record — they read `sourceKind` and
 * `verification`, which is what keeps demonstration data from ever being
 * presented as an official tender.
 */
import type { SourceKind, TenderStatus, VerificationStatus } from '@/lib/db/types';

export interface NormalizedTender {
  sourceRef: string;
  sourceUrl: string | null;
  title: string;
  entity: string;
  referenceNo: string | null;
  sector: string | null;
  region: string | null;
  type: string | null;
  status: TenderStatus;
  publishedAt: Date | null;
  closesAt: Date | null;
  estimatedValueBand: string | null;
  bondRequired: boolean | null;
  summary: string | null;
  scopeOfWork: string | null;
  submissionNotes: string | null;
  raw: unknown;
}

export interface DiscoveryQuery {
  keywords?: string[];
  sectors?: string[];
  regions?: string[];
  publishedAfter?: Date;
  closesBefore?: Date;
  limit?: number;
}

export type ProviderState = 'CONNECTED' | 'NOT_CONFIGURED' | 'DISABLED';

export interface DiscoveryResult {
  state: ProviderState;
  /** Empty when the provider is not configured — never a fabricated stand-in. */
  tenders: NormalizedTender[];
  /** Shown to the user verbatim when state is not CONNECTED. */
  note: string | null;
  fetchedAt: Date;
}

export interface ProcurementProvider {
  readonly key: string;
  readonly label: { ar: string; en: string };
  readonly sourceKind: SourceKind;
  readonly verification: VerificationStatus;
  readonly isDemo: boolean;
  state(): ProviderState;
  search(query: DiscoveryQuery): Promise<DiscoveryResult>;
  fetchDocuments?(sourceRef: string): Promise<{ title: string; url: string }[]>;
}
