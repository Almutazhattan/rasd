/**
 * "Load sample data": fills an empty workspace with labelled sample inputs and
 * queues a real analysis — and never touches a workspace that already has a
 * company, never pre-writes a result, and never runs for a role that could
 * not confirm the profile itself.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { getDb } from '@/lib/db';
import { __resetEnv } from '@/lib/env';
import { register } from '@/server/accounts';
import { loadDemoWorkspace, DEMO_MARK } from '@/server/demo-workspace';
import { getProfile, readiness } from '@/server/company';
import { expiringDocuments, listCompanyDocuments } from '@/server/documents';
import { scoped, type AuthContext } from '@/lib/tenancy';

let n = 0;
async function freshOwner(): Promise<AuthContext> {
  n += 1;
  const email = `demo${n}@demo.test`;
  const r = await register({ name: 'Demo Owner', email, password: 'demo-password-123', orgName: `Demo Org ${n}` });
  return { userId: r.userId, orgId: r.orgId, role: 'OWNER', email, name: 'Demo Owner' };
}

beforeAll(async () => { await resetDatabase(); });
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_PROVIDER = 'anthropic';
  __resetEnv();
});
afterAll(teardown);

describe('loadDemoWorkspace', () => {
  it('fills profile, documents, certifications, projects and sample tenders — all labelled', async () => {
    const ctx = await freshOwner();
    const r = await loadDemoWorkspace(ctx);

    const data = await getProfile(ctx);
    const profile = data?.profile as { legal_name: string; confirmed_at: Date | null };
    expect(profile.legal_name).toContain(DEMO_MARK);
    expect(profile.confirmed_at).not.toBeNull();
    expect(data?.capabilities.length).toBeGreaterThanOrEqual(3);
    expect(data?.certifications.length).toBe(1);
    expect(data?.pastProjects.length).toBe(2);

    const docs = (await listCompanyDocuments(ctx)) as { title: string; text_chars: number | null }[];
    expect(docs).toHaveLength(4);
    for (const d of docs) {
      expect(d.title).toContain(DEMO_MARK);
      expect(d.text_chars ?? 0).toBeGreaterThan(50); // extracted, so agents can read it
    }

    // The zakat certificate is set to expire soon on purpose: a real gap.
    const expiring = (await expiringDocuments(ctx, 30)) as { kind: string }[];
    expect(expiring.map((d) => d.kind)).toContain('zakat');

    const tenders = (await scoped(ctx).from('tenders').select(['id', 'is_demo']).execute()) as { is_demo: boolean }[];
    expect(tenders.length).toBe(r.tendersImported);
    expect(tenders.length).toBeGreaterThan(0);
    expect(tenders.every((t) => t.is_demo)).toBe(true);

    const booklet = (await scoped(ctx).from('tender_documents').selectAll()
      .where('tender_id' as never, '=', r.tenderId as never).execute()) as { readable: boolean; title: string }[];
    expect(booklet).toHaveLength(1);
    expect(booklet[0].readable).toBe(true);

    expect((await readiness(ctx)).score).toBeGreaterThan(0);
  });

  it('without an AI provider: starts no analysis and writes no result', async () => {
    const ctx = await freshOwner();
    const r = await loadDemoWorkspace(ctx);
    expect(r.aiConnected).toBe(false);
    expect(r.analysisId).toBeNull();
    const analyses = await scoped(ctx).from('analyses').selectAll().execute();
    expect(analyses).toHaveLength(0);
  });

  it('with an AI provider: queues a real analysis — queued, not pre-scored', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-used-0123456789';
    __resetEnv();
    const ctx = await freshOwner();
    const r = await loadDemoWorkspace(ctx);
    expect(r.aiConnected).toBe(true);
    expect(r.analysisId).toBeTruthy();

    const a = (await scoped(ctx).findById('analyses', r.analysisId!)) as { status: string; score: number | null };
    expect(a.status).toBe('QUEUED');
    expect(a.score).toBeNull();

    const job = await getDb().selectFrom('jobs').select(['type', 'status'])
      .where('org_id', '=', ctx.orgId).where('type', '=', 'RUN_ANALYSIS').executeTakeFirst();
    expect(job?.status).toBe('QUEUED');
  });

  it('refuses a workspace that already has a company profile — never overwrites real data', async () => {
    const ctx = await freshOwner();
    await loadDemoWorkspace(ctx);
    await expect(loadDemoWorkspace(ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a role that cannot confirm the company profile', async () => {
    const owner = await freshOwner();
    const viewer: AuthContext = { ...owner, role: 'REVIEWER' };
    await expect(loadDemoWorkspace(viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await getProfile(owner)).toBeNull();
  });
});
