/**
 * Tenant isolation — the platform's central security property.
 *
 * Two organizations, each with its own data. Every assertion here is about one
 * tenant being unable to see or change the other's rows through the sanctioned
 * data-access layer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase, teardown } from './setup';
import { getDb } from '@/lib/db';
import { scoped, type AuthContext } from '@/lib/tenancy';
import { register } from '@/server/accounts';

let alpha: AuthContext;
let beta: AuthContext;
let alphaTenderId: string;
let betaTenderId: string;

beforeAll(async () => {
  await resetDatabase();

  const a = await register({
    name: 'Alpha Owner', email: 'owner@alpha.test', password: 'alpha-password-1',
    orgName: 'Alpha Contracting',
  });
  const b = await register({
    name: 'Beta Owner', email: 'owner@beta.test', password: 'beta-password-1',
    orgName: 'Beta Systems',
  });

  alpha = { userId: a.userId, orgId: a.orgId, role: 'OWNER', email: 'owner@alpha.test', name: 'Alpha Owner' };
  beta = { userId: b.userId, orgId: b.orgId, role: 'OWNER', email: 'owner@beta.test', name: 'Beta Owner' };

  const mk = async (ctx: AuthContext, title: string) => {
    const row = await scoped(ctx)
      .insert('tenders', {
        source_kind: 'DEMO', source_name: 'demo', source_ref: `ref-${title}`,
        verification: 'DEMO_DATA', is_demo: true, retrieved_at: new Date(),
        title, entity: 'Test Entity', status: 'OPEN',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (row as { id: string }).id;
  };
  alphaTenderId = await mk(alpha, 'alpha-tender');
  betaTenderId = await mk(beta, 'beta-tender');
});

afterAll(teardown);

describe('reads', () => {
  it('each workspace lists only its own tenders', async () => {
    const aRows = await scoped(alpha).from('tenders').select(['id', 'title']).execute();
    const bRows = await scoped(beta).from('tenders').select(['id', 'title']).execute();

    expect(aRows.map((r) => r.title)).toEqual(['alpha-tender']);
    expect(bRows.map((r) => r.title)).toEqual(['beta-tender']);
  });

  it('a known id from another workspace reads as absent', async () => {
    expect(await scoped(alpha).findById('tenders', betaTenderId)).toBeNull();
    expect(await scoped(beta).findById('tenders', alphaTenderId)).toBeNull();
  });

  it('getById raises NOT_FOUND rather than leaking existence', async () => {
    await expect(scoped(alpha).getById('tenders', betaTenderId, 'Tender')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('writes', () => {
  it('an update aimed at another workspace changes nothing', async () => {
    await scoped(alpha)
      .update('tenders')
      .set({ title: 'hijacked' })
      .where('id' as never, '=', betaTenderId as never)
      .execute();

    const beta_ = await scoped(beta).getById('tenders', betaTenderId, 'Tender');
    expect(beta_.title).toBe('beta-tender');
  });

  it('a delete aimed at another workspace removes nothing', async () => {
    await scoped(alpha)
      .delete('tenders')
      .where('id' as never, '=', betaTenderId as never)
      .execute();

    expect(await scoped(beta).findById('tenders', betaTenderId)).not.toBeNull();
  });

  it('inserts are stamped with the acting workspace, not a caller-supplied one', async () => {
    await scoped(alpha)
      .insert('tenders', {
        // A caller trying to plant a row in another tenant:
        org_id: beta.orgId,
        source_kind: 'DEMO', source_name: 'demo', source_ref: 'smuggled',
        verification: 'DEMO_DATA', is_demo: true, retrieved_at: new Date(),
        title: 'smuggled', entity: 'E', status: 'OPEN',
      } as never)
      .execute();

    const inBeta = await scoped(beta).from('tenders').select('id').where('title' as never, '=', 'smuggled' as never).execute();
    const inAlpha = await scoped(alpha).from('tenders').select('id').where('title' as never, '=', 'smuggled' as never).execute();
    expect(inBeta).toHaveLength(0);
    expect(inAlpha).toHaveLength(1);
  });
});

describe('scope construction', () => {
  it('a context without an organization cannot build a scope at all', () => {
    expect(() => scoped({ ...alpha, orgId: '' })).toThrowError(/workspace/i);
  });

  it('deleting an organization removes its rows and leaves the other intact', async () => {
    await getDb().deleteFrom('organizations').where('id', '=', alpha.orgId).execute();

    const leftover = await getDb().selectFrom('tenders').select('id').where('org_id', '=', alpha.orgId).execute();
    const betaRows = await getDb().selectFrom('tenders').select('id').where('org_id', '=', beta.orgId).execute();
    expect(leftover).toHaveLength(0);
    expect(betaRows.length).toBeGreaterThan(0);
  });
});
