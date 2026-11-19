/**
 * Company profile — the platform's persistent memory of the business.
 *
 * Everything here is stored with a provenance. A capability the company typed
 * in is USER_PROVIDED and stays that way until a document backs it; nothing in
 * this module promotes a claim to VERIFIED on its own.
 */
import { z } from 'zod';
import { scoped, type Ctx } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { companyReadiness } from '@/lib/scoring';
import { expiringDocuments } from './documents';
import { requestApproval } from './approvals';

export const profileInput = z.object({
  legalName: z.string().min(2).max(200),
  crNumber: z.string().max(40).optional().nullable(),
  industries: z.array(z.string().max(120)).max(20).default([]),
  activities: z.array(z.string().max(200)).max(40).default([]),
  sizeBand: z.string().max(40).optional().nullable(),
  services: z.array(z.string().max(200)).max(60).default([]),
  regions: z.array(z.string().max(120)).max(30).default([]),
  employeeCount: z.number().int().min(0).max(1_000_000).optional().nullable(),
  annualRevenueBand: z.string().max(60).optional().nullable(),
  bondingCapacity: z.string().max(120).optional().nullable(),
  summary: z.string().max(4000).optional().nullable(),
});

export const capabilityInput = z.object({
  label: z.string().min(2).max(200),
  level: z.number().int().min(1).max(5).default(3),
});

export const certificationInput = z.object({
  name: z.string().min(2).max(200),
  issuer: z.string().max(200).optional().nullable(),
  number: z.string().max(120).optional().nullable(),
  issuedAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  documentId: z.string().max(64).optional().nullable(),
});

export const projectInput = z.object({
  title: z.string().min(2).max(300),
  client: z.string().max(200).optional().nullable(),
  sector: z.string().max(120).optional().nullable(),
  valueBand: z.string().max(60).optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  endedAt: z.coerce.date().optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  documentId: z.string().max(64).optional().nullable(),
});

export async function getProfile(ctx: Ctx) {
  const s = scoped(ctx);
  const profile = await s.from('company_profiles').selectAll().executeTakeFirst();
  if (!profile) return null;
  const profileId = (profile as { id: string }).id;
  const [capabilities, certifications, pastProjects] = await Promise.all([
    s.from('capabilities').selectAll().where('profile_id' as never, '=', profileId as never).orderBy('label').execute(),
    s.from('certifications').selectAll().where('profile_id' as never, '=', profileId as never).orderBy('name').execute(),
    s.from('past_projects').selectAll().where('profile_id' as never, '=', profileId as never).orderBy('started_at', 'desc').execute(),
  ]);
  return { profile, capabilities, certifications, pastProjects };
}

export async function saveProfile(ctx: Ctx, raw: unknown) {
  if (!('system' in ctx)) assertCan(ctx.role, 'profile:update');
  const input = profileInput.parse(raw);
  const s = scoped(ctx);
  const existing = await s.from('company_profiles').select('id').executeTakeFirst();

  const values = {
    legal_name: input.legalName,
    cr_number: input.crNumber ?? null,
    industries: input.industries,
    activities: input.activities,
    size_band: input.sizeBand ?? null,
    services: input.services,
    regions: input.regions,
    employee_count: input.employeeCount ?? null,
    annual_revenue_band: input.annualRevenueBand ?? null,
    bonding_capacity: input.bondingCapacity ?? null,
    summary: input.summary ?? null,
    updated_at: new Date(),
  };

  let profileId: string;
  if (existing) {
    profileId = (existing as { id: string }).id;
    // A material change invalidates the previous human confirmation.
    await s.update('company_profiles').set({ ...values, confirmed_at: null })
      .where('id' as never, '=', profileId as never).execute();
  } else {
    const row = await s.insert('company_profiles', values).returning('id').executeTakeFirstOrThrow();
    profileId = (row as { id: string }).id;
  }

  await audit(ctx, 'profile.update', { type: 'company_profile', id: profileId });
  await requestApproval(ctx, {
    type: 'COMPANY_PROFILE',
    subjectType: 'profile',
    subjectId: profileId,
    title: 'تأكيد بيانات المنشأة قبل الاعتماد عليها في التحليل',
    detail: 'التحليل يستند إلى هذه البيانات؛ تأكيدها يجعلها مرجعاً معتمداً داخل المنصة.',
  });
  return profileId;
}

/** The human checkpoint: a person states that the profile is correct. */
export async function confirmProfile(ctx: Ctx) {
  if (!('system' in ctx)) assertCan(ctx.role, 'profile:confirm');
  const s = scoped(ctx);
  const profile = await s.from('company_profiles').select('id').executeTakeFirst();
  if (!profile) throw notFound('No company profile to confirm.');
  await s.update('company_profiles').set({ confirmed_at: new Date() })
    .where('id' as never, '=', (profile as { id: string }).id as never).execute();
  await audit(ctx, 'profile.confirm', { type: 'company_profile', id: (profile as { id: string }).id });
}

async function profileId(ctx: Ctx): Promise<string> {
  const row = await scoped(ctx).from('company_profiles').select('id').executeTakeFirst();
  if (!row) throw notFound('Complete the company profile first.');
  return (row as { id: string }).id;
}

export async function addCapability(ctx: Ctx, raw: unknown) {
  if (!('system' in ctx)) assertCan(ctx.role, 'profile:update');
  const input = capabilityInput.parse(raw);
  await scoped(ctx).insert('capabilities', {
    profile_id: await profileId(ctx), label: input.label, level: input.level,
    provenance: 'USER_PROVIDED',
  }).execute();
}

export async function addCertification(ctx: Ctx, raw: unknown) {
  if (!('system' in ctx)) assertCan(ctx.role, 'profile:update');
  const input = certificationInput.parse(raw);
  await scoped(ctx).insert('certifications', {
    profile_id: await profileId(ctx), name: input.name, issuer: input.issuer ?? null,
    number: input.number ?? null, issued_at: input.issuedAt ?? null,
    expires_at: input.expiresAt ?? null, document_id: input.documentId ?? null,
    // A certificate with its document attached is verified; without it, stated.
    provenance: input.documentId ? 'VERIFIED' : 'USER_PROVIDED',
  }).execute();
}

export async function addPastProject(ctx: Ctx, raw: unknown) {
  if (!('system' in ctx)) assertCan(ctx.role, 'profile:update');
  const input = projectInput.parse(raw);
  await scoped(ctx).insert('past_projects', {
    profile_id: await profileId(ctx), title: input.title, client: input.client ?? null,
    sector: input.sector ?? null, value_band: input.valueBand ?? null,
    started_at: input.startedAt ?? null, ended_at: input.endedAt ?? null,
    description: input.description ?? null, document_id: input.documentId ?? null,
    provenance: input.documentId ? 'VERIFIED' : 'USER_PROVIDED',
  }).execute();
}

export async function removeChild(
  ctx: Ctx, table: 'capabilities' | 'certifications' | 'past_projects', id: string,
) {
  if (!('system' in ctx)) assertCan(ctx.role, 'profile:update');
  await scoped(ctx).delete(table).where('id' as never, '=', id as never).execute();
}

/** Readiness, computed from what is actually on file. */
export async function readiness(ctx: Ctx) {
  const s = scoped(ctx);
  const data = await getProfile(ctx);
  const docs = (await s
    .from('company_documents')
    .select(['id', 'extracted_at', 'text_chars'])
    .execute()) as { extracted_at: Date | null; text_chars: number | null }[];
  const expiring = await expiringDocuments(ctx, 60);

  const certifications = (data?.certifications ?? []) as { expires_at: Date | null }[];
  const valid = certifications.filter(
    (c) => c.expires_at && new Date(c.expires_at).getTime() > Date.now(),
  ).length;

  const result = companyReadiness({
    hasConfirmedProfile: Boolean((data?.profile as { confirmed_at: Date | null } | undefined)?.confirmed_at),
    capabilities: data?.capabilities.length ?? 0,
    certifications: certifications.length,
    validCertifications: valid,
    pastProjects: data?.pastProjects.length ?? 0,
    documents: docs.length,
    extractedDocuments: docs.filter((d) => d.extracted_at && (d.text_chars ?? 0) > 40).length,
    expiringSoon: expiring.length,
  });

  return { ...result, expiring };
}
