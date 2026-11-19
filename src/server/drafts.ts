/**
 * Response workspace.
 *
 * The drafting agent produces a structured draft; a person edits it; a reviewer
 * approves it; only then can it be exported. Two rules hold throughout:
 *
 *   • RASD never submits a tender. Export produces a file the authorized user
 *     downloads and submits themselves.
 *   • Export is gated on an approved EXPORT checkpoint, checked server-side in
 *     exportDraft — not by hiding the button.
 */
import { scoped, actorId, type Ctx, type AuthContext } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { conflict, notFound, validation } from '@/lib/errors';
import { AGENTS } from '@/agents/registry';
import { runAgent } from '@/agents/runner';
import type { DraftingOut } from '@/agents/contracts';
import { assertApproved, requestApproval } from './approvals';
import { VERDICT_LABELS } from '@/lib/scoring';
import type { Verdict } from '@/lib/db/types';
import { aiKeyName } from '@/lib/env';

export async function createDraft(ctx: Ctx, analysisId: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'draft:write');
  const s = scoped(ctx);
  const analysis = (await s.getById('analyses', analysisId, 'Analysis')) as {
    tender_id: string; status: string; score: number | null; verdict: Verdict | null;
  };
  if (analysis.status === 'PROVIDER_UNCONFIGURED') {
    throw conflict('This analysis never ran: no AI provider is configured. Configure one and re-run it first.');
  }
  const tender = (await s.getById('tenders', analysis.tender_id, 'Tender')) as { title: string };

  const row = await s
    .insert('response_drafts', { analysis_id: analysisId, title: `عرض — ${tender.title}`.slice(0, 280) })
    .returning('id')
    .executeTakeFirstOrThrow();
  const draftId = (row as { id: string }).id;

  const run = await runAgent<DraftingOut>({
    ctx, agent: AGENTS.drafting,
    input: { analysisId, tenderId: analysis.tender_id, draftId, purpose: 'draft' },
    analysisId, tenderId: analysis.tender_id,
  });

  if (run.status === 'PROVIDER_UNCONFIGURED') {
    await s.insert('response_sections', {
      draft_id: draftId, ordinal: 0, heading: 'المسودة لم تُنشأ',
      body:
        'لا يوجد مزوّد ذكاء اصطناعي مُهيّأ في هذا النشر، فلم يُنفَّذ وكيل إعداد العرض ولم ' +
        `يُصَغ أي نص. اضبط ${aiKeyName()} ثم أعد إنشاء المسودة.`,
      open_points: ['تهيئة مزوّد الذكاء الاصطناعي'],
    }).execute();
    await audit(ctx, 'draft.create', { type: 'response_draft', id: draftId }, { providerUnconfigured: true });
    return { draftId, status: 'PROVIDER_UNCONFIGURED' as const, sections: 1 };
  }

  if (run.status !== 'SUCCEEDED' || !run.output) {
    await s.insert('response_sections', {
      draft_id: draftId, ordinal: 0, heading: 'تعذّر إعداد المسودة',
      body: `لم يكمل وكيل إعداد العرض: ${run.error ?? 'سبب غير معروف'}`,
      open_points: ['إعادة المحاولة'],
    }).execute();
    return { draftId, status: 'FAILED' as const, sections: 1 };
  }

  const out = run.output;
  await s.insertMany(
    'response_sections',
    out.sections.map((sec, i) => ({
      draft_id: draftId, ordinal: i, heading: sec.heading.slice(0, 300), body: sec.body,
      open_points: sec.openPoints, source_refs: JSON.stringify(sec.sourceRefs),
    })),
  ).execute();

  // Map responses back onto the stored requirements; an unmatched response is
  // dropped rather than attached to the wrong requirement.
  const requirements = (await s
    .from('tender_requirements')
    .select(['id', 'text'])
    .where('tender_id' as never, '=', analysis.tender_id as never)
    .execute()) as { id: string; text: string }[];

  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
  const byText = new Map(requirements.map((r) => [norm(r.text), r.id]));
  const mappings = out.requirementResponses
    .map((r) => {
      const id =
        byText.get(norm(r.requirementText)) ??
        requirements.find((q) => norm(q.text).includes(norm(r.requirementText)))?.id ??
        null;
      return id ? { id, r } : null;
    })
    .filter((x): x is { id: string; r: DraftingOut['requirementResponses'][number] } => x !== null);

  if (mappings.length) {
    const seen = new Set<string>();
    const rows = mappings
      .filter(({ id }) => (seen.has(id) ? false : (seen.add(id), true)))
      .map(({ id, r }) => ({
        draft_id: draftId, requirement_id: id, response: r.response,
        evidence_note: r.evidenceNote, provenance: r.provenance, attachment_ref: r.attachmentRef,
      }));
    await s.insertMany('requirement_mappings', rows).execute();
  }

  await snapshot(ctx, draftId, 1, 'النسخة الأولى من الوكيل');

  await requestApproval(ctx, {
    type: 'RESPONSE_DRAFT', subjectType: 'draft', subjectId: draftId,
    analysisId, draftId, title: `مراجعة مسودة العرض — ${tender.title}`.slice(0, 280),
    detail:
      `${out.sections.length} قسم · ${out.unansweredQuestions.length} سؤال بلا إجابة · ` +
      `${out.attachmentChecklist.length} مرفق مطلوب`,
  });

  await audit(ctx, 'draft.create', { type: 'response_draft', id: draftId }, {
    sections: out.sections.length, mappings: mappings.length,
  });

  return {
    draftId, status: 'SUCCEEDED' as const, sections: out.sections.length,
    attachmentChecklist: out.attachmentChecklist, unansweredQuestions: out.unansweredQuestions,
  };
}

export async function getDraft(ctx: Ctx, draftId: string) {
  const s = scoped(ctx);
  const draft = await s.findById('response_drafts', draftId);
  if (!draft) throw notFound('Draft not found in this workspace.');
  const [sections, mappings, versions, comments] = await Promise.all([
    s.from('response_sections').selectAll().where('draft_id' as never, '=', draftId as never).orderBy('ordinal').execute(),
    s.from('requirement_mappings')
      .innerJoin('tender_requirements', 'tender_requirements.id', 'requirement_mappings.requirement_id')
      .select(['requirement_mappings.id as id', 'requirement_mappings.response as response',
        'requirement_mappings.evidence_note as evidence_note', 'requirement_mappings.provenance as provenance',
        'requirement_mappings.attachment_ref as attachment_ref',
        'tender_requirements.text as requirement', 'tender_requirements.category as category',
        'tender_requirements.mandatory as mandatory', 'tender_requirements.doc_ref as doc_ref',
        'tender_requirements.page_ref as page_ref'])
      .where('requirement_mappings.draft_id' as never, '=', draftId as never).execute(),
    s.from('draft_versions').select(['id', 'version', 'note', 'created_at'])
      .where('draft_id' as never, '=', draftId as never).orderBy('version', 'desc').execute(),
    s.from('comments')
      .innerJoin('users', 'users.id', 'comments.author_id')
      .select(['comments.id as id', 'comments.body as body', 'comments.created_at as created_at',
        'comments.section_id as section_id', 'users.name as author'])
      .where('comments.draft_id' as never, '=', draftId as never).orderBy('comments.created_at').execute(),
  ]);
  return { draft, sections, mappings, versions, comments };
}

export async function updateSection(ctx: Ctx, sectionId: string, body: string, heading?: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'draft:write');
  const s = scoped(ctx);
  const section = await s.findById('response_sections', sectionId);
  if (!section) throw notFound('Section not found in this workspace.');
  await s.update('response_sections')
    .set({ body: body.slice(0, 40_000), ...(heading ? { heading: heading.slice(0, 300) } : {}) })
    .where('id' as never, '=', sectionId as never).execute();

  const draftId = (section as { draft_id: string }).draft_id;
  // Editing after approval reopens the review: an approved draft and an edited
  // draft must not be the same record.
  await s.update('response_drafts').set({ approved_at: null, updated_at: new Date() })
    .where('id' as never, '=', draftId as never).execute();
  await audit(ctx, 'draft.update', { type: 'response_section', id: sectionId });
}

export async function addComment(ctx: AuthContext, draftId: string, body: string, sectionId?: string) {
  assertCan(ctx.role, 'draft:read');
  if (!body.trim()) throw validation('A comment needs some text.');
  await scoped(ctx).insert('comments', {
    draft_id: draftId, author_id: ctx.userId, section_id: sectionId ?? null, body: body.slice(0, 4000),
  }).execute();
}

export async function snapshot(ctx: Ctx, draftId: string, version: number, note?: string) {
  const s = scoped(ctx);
  const { sections, mappings } = await getDraft(ctx, draftId);
  await s.insert('draft_versions', {
    draft_id: draftId, version, snapshot: JSON.stringify({ sections, mappings }),
    author_id: actorId(ctx), note: note ?? null,
  }).onConflict((oc) => oc.columns(['draft_id', 'version']).doNothing()).execute();
}

export async function newVersion(ctx: Ctx, draftId: string, note?: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'draft:write');
  const s = scoped(ctx);
  const draft = (await s.getById('response_drafts', draftId, 'Draft')) as { version: number };
  const next = draft.version + 1;
  await snapshot(ctx, draftId, next, note);
  await s.update('response_drafts').set({ version: next, updated_at: new Date() })
    .where('id' as never, '=', draftId as never).execute();
  return next;
}

/**
 * Ask a reviewer to approve exporting this draft. Separate from approving the
 * draft's content: one says "the text is right", the other says "this may
 * leave the platform".
 */
export async function requestExportApproval(ctx: Ctx, draftId: string) {
  if (!('system' in ctx)) assertCan(ctx.role, 'approval:request');
  const s = scoped(ctx);
  const draft = (await s.getById('response_drafts', draftId, 'Draft')) as {
    title: string; approved_at: Date | null; analysis_id: string;
  };
  if (!draft.approved_at) {
    throw conflict('Approve the draft itself before asking to approve its export.');
  }
  return requestApproval(ctx, {
    type: 'EXPORT',
    subjectType: 'export',
    subjectId: draftId,
    analysisId: draft.analysis_id,
    draftId,
    title: `اعتماد تصدير — ${draft.title}`.slice(0, 280),
    detail: 'التصدير يسلّم ملفاً للمستخدم المفوّض. لا تُقدِّم المنصة أي عرض حكومي تلقائياً.',
  });
}

/**
 * Export an approved draft. Produces Markdown and print-ready HTML.
 *
 * Native .docx and .pdf writers are not part of this build: the HTML is laid
 * out for printing to PDF from the browser, and the Markdown opens in Word.
 * This limitation is stated in docs/LIMITATIONS.md rather than papered over
 * with a mislabelled file.
 */
export async function exportDraft(ctx: Ctx, draftId: string, format: 'md' | 'html') {
  if (!('system' in ctx)) assertCan(ctx.role, 'draft:export');
  const s = scoped(ctx);
  const { draft, sections, mappings } = await getDraft(ctx, draftId);
  const d = draft as { title: string; approved_at: Date | null; analysis_id: string; version: number };

  if (!d.approved_at) {
    throw conflict('This draft has not been approved yet. A reviewer must approve it before export.');
  }
  await assertApproved(ctx, 'EXPORT', draftId, 'Exporting a response');

  const analysis = (await s.getById('analyses', d.analysis_id, 'Analysis')) as {
    score: number | null; verdict: Verdict | null; blocking_gaps: number;
  };

  const header = [
    `# ${d.title}`,
    '',
    `النسخة: ${d.version} · تاريخ التصدير: ${new Date().toISOString().slice(0, 10)}`,
    analysis.verdict
      ? `التوصية: ${VERDICT_LABELS[analysis.verdict].ar} · الدرجة: ${analysis.score ?? '—'}/100 · ` +
        `متطلبات إلزامية ناقصة: ${analysis.blocking_gaps}`
      : '',
    '',
    '> أُعدّت هذه المسودة بمساعدة وكلاء RASD واعتمدها مراجع بشري. التقديم الفعلي مسؤولية ' +
      'المستخدم المفوّض — لا تُقدِّم المنصة أي عرض حكومي تلقائياً.',
    '',
  ].filter(Boolean).join('\n');

  const body = (sections as { heading: string; body: string; open_points: string[] }[])
    .map((sec) => {
      const open = sec.open_points.length
        ? `\n\n**نقاط مفتوحة تحتاج استكمالاً من المنشأة:**\n${sec.open_points.map((p) => `- ${p}`).join('\n')}`
        : '';
      return `## ${sec.heading}\n\n${sec.body}${open}`;
    })
    .join('\n\n');

  const matrix = (mappings as {
    requirement: string; mandatory: boolean; response: string | null;
    provenance: string; doc_ref: string | null; page_ref: number | null;
  }[]);

  const matrixMd = matrix.length
    ? [
        '## مصفوفة المتطلبات',
        '',
        '| المتطلب | إلزامي | الردّ | المصدر | المرجع |',
        '| --- | --- | --- | --- | --- |',
        ...matrix.map((m) =>
          `| ${esc(m.requirement)} | ${m.mandatory ? 'نعم' : 'لا'} | ${esc(m.response ?? '— غير متوفر')} | ` +
          `${m.provenance} | ${m.doc_ref ? `${esc(m.doc_ref)}${m.page_ref ? ` ص${m.page_ref}` : ''}` : '—'} |`),
      ].join('\n')
    : '';

  const markdown = [header, body, matrixMd].filter(Boolean).join('\n\n');

  await s.update('response_drafts').set({ exported_at: new Date() })
    .where('id' as never, '=', draftId as never).execute();
  await audit(ctx, 'draft.export', { type: 'response_draft', id: draftId }, { format });

  if (format === 'md') {
    return { filename: `${slug(d.title)}-v${d.version}.md`, mimeType: 'text/markdown; charset=utf-8', content: markdown };
  }
  return {
    filename: `${slug(d.title)}-v${d.version}.html`,
    mimeType: 'text/html; charset=utf-8',
    content: printableHtml(d.title, markdown),
  };
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 400);
const slug = (s: string) => s.replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'draft';

/** Minimal print stylesheet: A4, RTL, no external requests. */
function printableHtml(title: string, markdown: string): string {
  const html = markdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith('> ')) return `<blockquote>${escapeHtml(line.slice(2))}</blockquote>`;
      if (line.startsWith('- ')) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (line.startsWith('|')) return `<tr>${line.split('|').slice(1, -1).map((c) => `<td>${escapeHtml(c.trim())}</td>`).join('')}</tr>`;
      if (!line.trim()) return '';
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join('\n')
    .replace(/(<tr>[\s\S]*<\/tr>)/, '<table>$1</table>');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  body { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; line-height: 1.85; color: #1E1E1C; }
  h1 { font-size: 22pt; margin: 0 0 6mm; }
  h2 { font-size: 14pt; margin: 10mm 0 3mm; border-bottom: 1px solid #D8CBB3; padding-bottom: 2mm; }
  blockquote { border-inline-start: 3px solid #2F6BFF; margin: 6mm 0; padding: 0 4mm; color: #4a4a46; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4mm; }
  td { border: 1px solid #ddd8cc; padding: 2mm; vertical-align: top; }
  li { margin-inline-start: 6mm; }
</style></head><body>
${html}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function listDrafts(ctx: Ctx) {
  return scoped(ctx)
    .from('response_drafts')
    .innerJoin('analyses', 'analyses.id', 'response_drafts.analysis_id')
    .innerJoin('tenders', 'tenders.id', 'analyses.tender_id')
    .select(['response_drafts.id as id', 'response_drafts.title as title',
      'response_drafts.version as version', 'response_drafts.approved_at as approved_at',
      'response_drafts.exported_at as exported_at', 'response_drafts.updated_at as updated_at',
      'tenders.title as tender_title', 'analyses.id as analysis_id'])
    .orderBy('response_drafts.updated_at', 'desc')
    .limit(100)
    .execute();
}
