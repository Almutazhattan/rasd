/**
 * Development seed.
 *
 * Creates two organizations so tenant isolation is visible by hand, a user in
 * each, a company profile with documents' worth of capability, and pulls the
 * demonstration tenders in. It does NOT run an analysis: that needs a real AI
 * provider, and seeding a fabricated analysis would be exactly the kind of
 * fake data this platform refuses to show.
 *
 *   npm run db:seed
 */
import { register } from '../src/server/accounts';
import { saveProfile, addCapability, addCertification, addPastProject, confirmProfile } from '../src/server/company';
import { discover } from '../src/server/providers';
import { closeDb } from '../src/lib/db';
import { aiState } from '../src/lib/env';
import type { AuthContext } from '../src/lib/tenancy';

const PASSWORD = 'rasd-dev-password';

async function makeWorkspace(orgName: string, name: string, email: string) {
  const r = await register({ name, email, password: PASSWORD, orgName });
  const ctx: AuthContext = { userId: r.userId, orgId: r.orgId, role: 'OWNER', email, name };
  return ctx;
}

async function main() {
  console.log('· seeding');

  const alpha = await makeWorkspace('مقاولات ألفا', 'مالك ألفا', 'owner@alpha.test');
  await saveProfile(alpha, {
    legalName: 'شركة مقاولات ألفا',
    crNumber: '1010000001',
    industries: ['الإنشاءات والمقاولات'],
    activities: ['ترميم وصيانة المباني', 'أعمال كهربائية'],
    sizeBand: 'medium',
    services: ['ترميم واجهات', 'تحديث لوحات كهربائية', 'صيانة تكييف'],
    regions: ['منطقة الرياض', 'منطقة جازان'],
    employeeCount: 140,
    annualRevenueBand: '١٠–٥٠ مليون ريال',
    bondingCapacity: 'حتى ١٠ مليون ريال',
    summary: 'مقاولات مباني وصيانة، بخبرة في المشاريع الحكومية.',
  });
  await addCapability(alpha, { label: 'ترميم المباني', level: 5 });
  await addCapability(alpha, { label: 'أعمال التكييف', level: 4 });
  await addCertification(alpha, {
    name: 'تصنيف المقاولين — الدرجة الرابعة (مباني)',
    issuer: 'وزارة الشؤون البلدية',
    expiresAt: new Date(Date.now() + 300 * 86_400_000),
  });
  await addPastProject(alpha, {
    title: 'ترميم مجمّع تعليمي',
    client: 'جهة حكومية',
    sector: 'الإنشاءات والمقاولات',
    valueBand: '٥–١٠ مليون ريال',
    description: 'ترميم واجهات وإعادة تأهيل أنظمة تكييف لمجمّع قائم.',
  });
  await confirmProfile(alpha);
  const alphaDiscovery = await discover(alpha, {});
  console.log(`  ألفا: ${alphaDiscovery.imported} فرصة توضيحية`);

  const beta = await makeWorkspace('بيتا للتقنية', 'مالك بيتا', 'owner@beta.test');
  await saveProfile(beta, {
    legalName: 'شركة بيتا للتقنية',
    industries: ['تقنية المعلومات'],
    activities: ['تطوير برمجيات', 'شبكات'],
    sizeBand: 'small',
    services: ['تطوير منصات', 'تركيب شبكات', 'أمن المعلومات'],
    regions: ['منطقة مكة المكرمة', 'منطقة جازان'],
    employeeCount: 32,
    summary: 'تطوير منصات إلكترونية وتكاملات، وأعمال شبكات.',
  });
  await addCapability(beta, { label: 'تطوير منصات ويب', level: 5 });
  await addCapability(beta, { label: 'تركيب وتهيئة الشبكات', level: 4 });
  // Deliberately expired, so the compliance agent has something real to flag.
  await addCertification(beta, {
    name: 'ISO 27001',
    issuer: 'جهة مانحة',
    expiresAt: new Date(Date.now() - 30 * 86_400_000),
  });
  const betaDiscovery = await discover(beta, {});
  console.log(`  بيتا: ${betaDiscovery.imported} فرصة توضيحية`);

  console.log('\n✓ seeded');
  console.log(`  owner@alpha.test / ${PASSWORD}`);
  console.log(`  owner@beta.test  / ${PASSWORD}`);
  if (aiState() !== 'CONNECTED') {
    console.log(
      '\n· no AI provider configured: no analysis was seeded. Set ANTHROPIC_API_KEY and run an\n' +
      '  analysis from the UI to see the agents work. Nothing fake was inserted in its place.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
