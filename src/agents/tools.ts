/**
 * Tool registry.
 *
 * Agents act only through these tools. Three properties matter:
 *
 *   1. Every tool runs inside the caller's tenant scope, so a tool cannot read
 *      another organization's data even if a model asks it to.
 *   2. Every input is validated with zod before the tool body runs.
 *   3. Every invocation is written to agent_steps with its input and output, so
 *      a run can be replayed and audited afterwards.
 *
 * Tools that return document text wrap it in <untrusted-document> markers.
 * Document text is data: instructions found inside it are quoted content, and
 * the agent prompts say so explicitly. The structural guarantee is that an
 * agent can only ever call a tool from its own allowlist with validated
 * arguments, so injected text has no action available to it.
 */
import { z } from 'zod';
import { scoped, type Ctx } from '@/lib/tenancy';
import { etimadState } from '@/lib/env';
import type { JsonSchema } from './jsonschema';
import { zodToJsonSchema } from './jsonschema';

export interface ToolContext {
  ctx: Ctx;
  tenderId?: string;
  analysisId?: string;
}

export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny> {
  key: string;
  description: string;
  input: I;
  /** Read-only tools may run concurrently; writers are serialized. */
  readOnly: boolean;
  run(args: z.infer<I>, tc: ToolContext): Promise<unknown>;
}

const UNTRUSTED_OPEN = '<untrusted-document name="%s" page="%s">';
const UNTRUSTED_CLOSE = '</untrusted-document>';

function wrapUntrusted(name: string, page: number | null, text: string): string {
  return `${UNTRUSTED_OPEN.replace('%s', name).replace('%s', page === null ? '?' : String(page))}\n${text}\n${UNTRUSTED_CLOSE}`;
}

// ───────────────────────────── company knowledge ─────────────────────────────

const companyProfileTool: ToolDefinition = {
  key: 'company_profile_read',
  description:
    'Read the company profile for this workspace: activities, services, regions, size, ' +
    'capabilities, certifications (with expiry) and past projects. Each item carries a ' +
    'provenance; USER_PROVIDED means the company stated it and it is not verified.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    const s = scoped(tc.ctx);
    const profile = await s.from('company_profiles').selectAll().executeTakeFirst();
    if (!profile) {
      return { present: false, note: 'No company profile has been completed for this workspace yet.' };
    }
    const profileId = (profile as { id: string }).id;
    const [capabilities, certifications, projects] = await Promise.all([
      s.from('capabilities').select(['label', 'level', 'provenance'])
        .where('profile_id' as never, '=', profileId as never).execute(),
      s.from('certifications').select(['name', 'issuer', 'number', 'issued_at', 'expires_at', 'provenance'])
        .where('profile_id' as never, '=', profileId as never).execute(),
      s.from('past_projects').select(['title', 'client', 'sector', 'value_band', 'started_at', 'ended_at', 'description', 'provenance'])
        .where('profile_id' as never, '=', profileId as never).execute(),
    ]);
    return { present: true, profile, capabilities, certifications, pastProjects: projects };
  },
};

const companyDocsTool: ToolDefinition = {
  key: 'company_documents_list',
  description:
    'List the company documents on file, with kind, title, expiry and whether text has ' +
    'been extracted. Use this to decide whether a required document exists before ' +
    'claiming compliance.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    return scoped(tc.ctx)
      .from('company_documents')
      .select(['id', 'kind', 'title', 'expires_at', 'extracted_at', 'page_count', 'mime_type'])
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
  },
};

const companyDocSearchTool: ToolDefinition = {
  key: 'company_documents_search',
  description:
    'Full-text search across extracted company document text. Returns matching passages ' +
    'with their document title and page number, wrapped as untrusted document content.',
  input: z.object({
    query: z.string().min(2).max(200).describe('words to look for'),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  readOnly: true,
  async run(args, tc) {
    const rows = await scoped(tc.ctx)
      .from('document_chunks')
      .innerJoin('company_documents', 'company_documents.id', 'document_chunks.company_document_id')
      .select([
        'company_documents.title as title',
        'document_chunks.page as page',
        'document_chunks.text as text',
      ])
      .where('document_chunks.text' as never, 'ilike' as never, `%${args.query}%` as never)
      .limit(args.limit)
      .execute();
    return (rows as { title: string; page: number | null; text: string }[]).map((r) => ({
      document: r.title,
      page: r.page,
      passage: wrapUntrusted(r.title, r.page, r.text.slice(0, 4000)),
    }));
  },
};

// ────────────────────────────── tender knowledge ──────────────────────────────

const tenderReadTool: ToolDefinition = {
  key: 'tender_read',
  description:
    'Read the tender record: entity, dates, status, value band, scope of work, submission ' +
    'notes, source and verification status. verification=DEMO_DATA means this is sample ' +
    'data and must not be treated as a live official tender.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    if (!tc.tenderId) return { error: 'No tender in scope for this run.' };
    const tender = await scoped(tc.ctx).findById('tenders', tc.tenderId);
    if (!tender) return { error: 'Tender not found in this workspace.' };
    const { raw: _raw, ...rest } = tender as Record<string, unknown>;
    return rest;
  },
};

const tenderDocsTool: ToolDefinition = {
  key: 'tender_documents_list',
  description:
    'List the tender documents attached to this tender, including whether each one could ' +
    'be read. readable=false means the file is scanned or protected: report it as ' +
    'unreadable rather than inferring its contents.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    if (!tc.tenderId) return [];
    return scoped(tc.ctx)
      .from('tender_documents')
      .select(['id', 'title', 'page_count', 'readable', 'note', 'extracted_at', 'mime_type'])
      .where('tender_id' as never, '=', tc.tenderId as never)
      .execute();
  },
};

const tenderDocReadTool: ToolDefinition = {
  key: 'tender_document_read',
  description:
    'Read extracted text from a tender document, a page range at a time, wrapped as ' +
    'untrusted document content. Always cite the document title and page number for any ' +
    'requirement you extract from it.',
  input: z.object({
    documentId: z.string().min(1).max(64),
    fromPage: z.number().int().min(1).max(5000).default(1),
    pages: z.number().int().min(1).max(30).default(8),
  }),
  readOnly: true,
  async run(args, tc) {
    const doc = await scoped(tc.ctx).findById('tender_documents', args.documentId);
    if (!doc) return { error: 'Document not found in this workspace.' };
    const d = doc as { title: string; readable: boolean; note: string | null };
    if (!d.readable) {
      return { document: d.title, readable: false, note: d.note ?? 'This document could not be read.' };
    }
    const rows = await scoped(tc.ctx)
      .from('document_chunks')
      .select(['page', 'ordinal', 'text'])
      .where('tender_document_id' as never, '=', args.documentId as never)
      .where('page' as never, '>=', args.fromPage as never)
      .where('page' as never, '<', (args.fromPage + args.pages) as never)
      .orderBy('ordinal')
      .limit(80)
      .execute();
    const chunks = rows as { page: number | null; text: string }[];
    return {
      document: d.title,
      readable: true,
      fromPage: args.fromPage,
      passages: chunks.map((c) => wrapUntrusted(d.title, c.page, c.text)),
      exhausted: chunks.length === 0,
    };
  },
};

const tenderRequirementsTool: ToolDefinition = {
  key: 'tender_requirements_list',
  description:
    'List requirements already extracted for this tender, with category, whether they are ' +
    'mandatory, and their document and page reference.',
  input: z.object({ category: z.enum(['technical', 'administrative', 'financial', 'legal']).optional() }),
  readOnly: true,
  async run(args, tc) {
    if (!tc.tenderId) return [];
    let q = scoped(tc.ctx)
      .from('tender_requirements')
      .select(['id', 'category', 'mandatory', 'text', 'doc_ref', 'page_ref', 'provenance', 'confidence'])
      .where('tender_id' as never, '=', tc.tenderId as never);
    if (args.category) q = q.where('category' as never, '=', args.category as never);
    return q.limit(400).execute();
  },
};

const tenderQaTool: ToolDefinition = {
  key: 'tender_qa_list',
  description: 'List published questions and answers recorded for this tender, when any exist.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    if (!tc.tenderId) return [];
    return scoped(tc.ctx)
      .from('tender_qa')
      .select(['question', 'answer', 'asked_at', 'source_ref'])
      .where('tender_id' as never, '=', tc.tenderId as never)
      .limit(200)
      .execute();
  },
};

// ───────────────────────── analysis context (read-only) ─────────────────────────

const analysisContextTool: ToolDefinition = {
  key: 'analysis_context_read',
  description:
    'Read what earlier agents in this run have already established: score dimensions, ' +
    'compliance items, risks and evidence. Use it instead of repeating their work.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    if (!tc.analysisId) return { error: 'No analysis in scope for this run.' };
    const s = scoped(tc.ctx);
    const [dimensions, compliance, risks, evidence] = await Promise.all([
      s.from('score_dimensions').select(['key', 'label', 'weight', 'raw', 'rationale'])
        .where('analysis_id' as never, '=', tc.analysisId as never).execute(),
      s.from('compliance_items').select(['label', 'category', 'mandatory', 'status', 'blocking', 'note'])
        .where('analysis_id' as never, '=', tc.analysisId as never).execute(),
      s.from('risks').select(['category', 'severity', 'likelihood', 'impact', 'title', 'detail'])
        .where('analysis_id' as never, '=', tc.analysisId as never).execute(),
      s.from('evidence').select(['provenance', 'statement', 'source_type', 'doc_ref', 'page_ref'])
        .where('analysis_id' as never, '=', tc.analysisId as never).limit(200).execute(),
    ]);
    return { dimensions, compliance, risks, evidence };
  },
};

const scoringWeightsTool: ToolDefinition = {
  key: 'scoring_weights_read',
  description:
    'Read this workspace\'s evaluation weights. The weighted score is computed by the ' +
    'platform, not by you; this is for explaining how dimensions are combined.',
  input: z.object({}),
  readOnly: true,
  async run(_args, tc) {
    const w = await scoped(tc.ctx).from('scoring_weights').selectAll().executeTakeFirst();
    return w ?? { note: 'Workspace uses platform default weights.' };
  },
};

const pastDecisionsTool: ToolDefinition = {
  key: 'past_decisions_read',
  description:
    'Read how this workspace decided on earlier opportunities — verdict, score and ' +
    'blocking gaps — plus any human corrections. Useful for consistency with precedent.',
  input: z.object({ limit: z.number().int().min(1).max(25).default(10) }),
  readOnly: true,
  async run(args, tc) {
    return scoped(tc.ctx)
      .from('analyses')
      .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
      .select([
        'tenders.title as tender', 'analyses.verdict as verdict', 'analyses.score as score',
        'analyses.blocking_gaps as blocking_gaps', 'analyses.summary as summary',
        'analyses.finished_at as finished_at',
      ])
      .where('analyses.status' as never, '=', 'COMPLETE' as never)
      .orderBy('analyses.finished_at', 'desc')
      .limit(args.limit)
      .execute();
  },
};

/**
 * Authorized external search. Deliberately not wired to a provider: no
 * credentialed search integration ships with this repository, so the tool
 * reports its state instead of returning fabricated results. See
 * docs/INTEGRATIONS.md for how to add one.
 */
const webSearchTool: ToolDefinition = {
  key: 'authorized_web_search',
  description:
    'Search authorized external sources. Returns NOT_CONFIGURED when no search provider ' +
    'is configured for this deployment — treat that as "no information available", never ' +
    'as licence to assume an answer.',
  input: z.object({ query: z.string().min(2).max(300) }),
  readOnly: true,
  async run(args) {
    return {
      state: 'NOT_CONFIGURED',
      query: args.query,
      results: [],
      note:
        'No authorized search provider is configured for this deployment. ' +
        'Do not substitute remembered or assumed information for a search result.',
    };
  },
};

const procurementSourceTool: ToolDefinition = {
  key: 'procurement_source_status',
  description:
    'Report whether the official procurement source integration (Etimad) is connected for ' +
    'this deployment, so you can state plainly whether a record is official or sample data.',
  input: z.object({}),
  readOnly: true,
  async run() {
    return { etimad: etimadState() };
  },
};

export const TOOLS: Record<string, ToolDefinition> = Object.fromEntries(
  [
    companyProfileTool, companyDocsTool, companyDocSearchTool,
    tenderReadTool, tenderDocsTool, tenderDocReadTool, tenderRequirementsTool, tenderQaTool,
    analysisContextTool, scoringWeightsTool, pastDecisionsTool,
    webSearchTool, procurementSourceTool,
  ].map((t) => [t.key, t]),
);

export function toolSpec(key: string): { name: string; description: string; input_schema: JsonSchema } {
  const tool = TOOLS[key];
  if (!tool) throw new Error(`Unknown tool: ${key}`);
  return { name: tool.key, description: tool.description, input_schema: zodToJsonSchema(tool.input) };
}

export function toolSpecs(keys: readonly string[]) {
  return keys.map(toolSpec);
}
