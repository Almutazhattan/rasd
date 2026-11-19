/**
 * "Try it with sample data" — fills a new workspace with a labelled sample
 * company so every screen has something to work on, then starts a REAL
 * analysis on one sample tender.
 *
 * What is sample and what is not:
 *  - The company profile, its documents and the tenders are sample inputs,
 *    each labelled «تجريبي» / DEMO wherever it appears.
 *  - The analysis is not. It is queued exactly like one the user starts, and
 *    the configured AI provider runs every agent on these inputs. Nothing is
 *    pre-scored or pre-written: the platform's rule of never showing an agent
 *    result that no agent produced still holds. Without a provider, the run
 *    ends PROVIDER_UNCONFIGURED like any other.
 *
 * The sample company is a partial match for DEMO-0001 by design: it holds the
 * ISO 27001 the tender asks for, but has one comparable project where two are
 * required, no GOSI certificate on file, and a zakat certificate about to
 * expire — so compliance and risk have real gaps to find.
 *
 * Only for a workspace that has no company profile yet, so it can never
 * overwrite a real company's data.
 */
import { scoped, type AuthContext } from '@/lib/tenancy';
import { assertCan } from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import { aiState } from '@/lib/env';
import { audit } from '@/lib/audit';
import { saveProfile, addCapability, addCertification, addPastProject, confirmProfile } from './company';
import { uploadCompanyDocument, uploadTenderDocument } from './documents';
import { discover } from './providers';
import { startAnalysis } from './analysis';
import { notify } from './notifications';

export const DEMO_MARK = '(تجريبي)';
const DAY = 86_400_000;
const NOTICE = 'وثيقة توضيحية لأغراض تجربة منصة رَصْد — ليست وثيقة رسمية ولا تخص منشأة حقيقية.';

const txt = (s: string) => new TextEncoder().encode(`${NOTICE}\n\n${s.trim()}\n`);

const COMPANY_DOCS: { title: string; kind: string; expiresInDays: number | null; body: string }[] = [
  {
    title: `السجل التجاري ${DEMO_MARK}`, kind: 'cr', expiresInDays: 210,
    body: `
السجل التجاري
اسم المنشأة: شركة رَصْد التجريبية للتقنية
رقم السجل: DEMO-1010000000
النشاط: تقنية المعلومات — تركيب الشبكات وتطوير البرمجيات
المدينة: جازان
تاريخ الانتهاء: بعد ٢١٠ أيام من تاريخ الرفع`,
  },
  {
    title: `شهادة ISO/IEC 27001 ${DEMO_MARK}`, kind: 'iso', expiresInDays: 420,
    body: `
شهادة نظام إدارة أمن المعلومات ISO/IEC 27001:2022
الجهة الحاصلة: شركة رَصْد التجريبية للتقنية
النطاق: تصميم وتركيب وصيانة الشبكات، وتطوير المنصات الإلكترونية
رقم الشهادة: DEMO-ISMS-0427
سارية حتى: بعد ٤٢٠ يوماً من تاريخ الرفع`,
  },
  {
    title: `شهادة الزكاة ${DEMO_MARK}`, kind: 'zakat', expiresInDays: 18,
    body: `
شهادة الزكاة
الجهة الحاصلة: شركة رَصْد التجريبية للتقنية
رقم الشهادة: DEMO-ZK-8812
سارية حتى: بعد ١٨ يوماً من تاريخ الرفع — يلزم التجديد قبل تقديم أي عرض`,
  },
  {
    title: `شهادة إنجاز — شبكة مبنى إداري ${DEMO_MARK}`, kind: 'reference', expiresInDays: null,
    body: `
شهادة إنجاز مشروع
المشروع: توريد وتركيب شبكة محلية ولاسلكية لمبنى إداري من ثلاثة طوابق
المالك: جهة حكومية (بيانات توضيحية)
القيمة: ١٫٤ مليون ريال
مدة التنفيذ: ٩٠ يوماً — اكتمل قبل سنتين
الأعمال: تمديد ٤٢٠ نقطة شبكة، توريد مبدّلات مُدارة وموجّهات، إعداد غرفة الاتصالات، تهيئة الشبكة اللاسلكية، اختبار القبول، وتدريب الفريق.
التقييم: أُنجز في المدة المحددة دون ملاحظات جوهرية.`,
  },
];

const TENDER_BOOKLET = `
كراسة الشروط والمواصفات — توريد وتركيب شبكة حاسوبية لمبنى إداري
الرقم المرجعي: DEMO/NET/0001

١. نطاق العمل
- تمديد كوابل الشبكة (Cat6A) لعدد ٦٠٠ نقطة في أربعة طوابق.
- توريد وتركيب مبدّلات مُدارة من الطبقة الثالثة وموجّهات حدودية.
- إعداد غرفة الاتصالات: خزائن، تبريد، ومصدر طاقة احتياطي.
- تهيئة الشبكة اللاسلكية لتغطية كامل المبنى.
- اختبار القبول وتسليم المخططات النهائية.
- تدريب فريق تقنية المعلومات في الجهة.
- الضمان والصيانة الوقائية لمدة سنتين.

٢. المتطلبات الإلزامية (يُستبعد العرض عند نقص أيٍّ منها)
- سجل تجاري ساري يشمل نشاط تقنية المعلومات.
- شهادة ISO/IEC 27001 سارية.
- شهادة الزكاة سارية وقت التقديم.
- شهادة التأمينات الاجتماعية (GOSI) سارية.
- خبرة في مشروعين مماثلين على الأقل خلال آخر خمس سنوات، مع شهادات إنجاز.
- خطاب ضمان ابتدائي بنسبة ٢٪ من قيمة العرض.

٣. المدة
- مدة التنفيذ ١٢٠ يوماً من تاريخ تسليم الموقع.
- غرامة تأخير ٠٫٥٪ عن كل أسبوع بحد أقصى ١٠٪.

٤. معايير التقييم
- العرض الفني ٦٠٪: الخبرة السابقة، المنهجية، الفريق، الجدول الزمني.
- العرض المالي ٤٠٪.

٥. التقديم
- يُقدَّم العرض الفني والمالي في مظروفين منفصلين.
- آخر موعد للاستفسارات قبل الإغلاق بعشرة أيام.
`;

export interface DemoWorkspaceResult {
  tenderId: string;
  analysisId: string | null;
  aiConnected: boolean;
  tendersImported: number;
}

export async function loadDemoWorkspace(ctx: AuthContext): Promise<DemoWorkspaceResult> {
  // Confirming the profile is part of this, so it needs the confirming role.
  assertCan(ctx.role, 'profile:confirm');
  const s = scoped(ctx);

  const existing = await s.from('company_profiles').select('id').executeTakeFirst();
  if (existing) {
    throw new AppError(
      'CONFLICT',
      'مساحة العمل هذه فيها ملف منشأة بالفعل. البيانات التجريبية متاحة لمساحة عمل جديدة فقط، حتى لا تختلط ببيانات منشأتك.',
    );
  }

  await saveProfile(ctx, {
    legalName: `شركة رَصْد التجريبية للتقنية ${DEMO_MARK}`,
    crNumber: 'DEMO-1010000000',
    industries: ['تقنية المعلومات'],
    activities: ['تركيب وصيانة الشبكات', 'تطوير البرمجيات والمنصات'],
    sizeBand: 'small',
    services: ['تصميم وتركيب الشبكات المحلية واللاسلكية', 'تطوير منصات ويب', 'أمن المعلومات', 'الدعم والصيانة'],
    regions: ['منطقة جازان', 'منطقة مكة المكرمة', 'منطقة عسير'],
    employeeCount: 38,
    annualRevenueBand: '٥–١٠ مليون ريال',
    bondingCapacity: 'خطابات ضمان حتى ٣ مليون ريال',
    summary:
      'منشأة تقنية صغيرة بيانات توضيحية لتجربة المنصة: تركيب شبكات وتطوير منصات للجهات الحكومية ' +
      'والقطاع الخاص في الجنوب والغرب.',
  });

  await addCapability(ctx, { label: 'تصميم وتركيب الشبكات المحلية', level: 5 });
  await addCapability(ctx, { label: 'الشبكات اللاسلكية المؤسسية', level: 4 });
  await addCapability(ctx, { label: 'تطوير منصات ويب', level: 4 });
  await addCapability(ctx, { label: 'إعداد غرف الاتصالات', level: 3 });

  const now = Date.now();
  const docIds: Record<string, string> = {};
  for (const d of COMPANY_DOCS) {
    const up = await uploadCompanyDocument(ctx, {
      title: d.title, kind: d.kind, mimeType: 'text/plain', bytes: txt(d.body),
      expiresAt: d.expiresInDays === null ? null : new Date(now + d.expiresInDays * DAY),
    });
    docIds[d.kind] = up.id;
  }

  await addCertification(ctx, {
    name: 'ISO/IEC 27001:2022', issuer: 'جهة مانحة (بيانات توضيحية)', number: 'DEMO-ISMS-0427',
    expiresAt: new Date(now + 420 * DAY), documentId: docIds.iso,
  });
  await addPastProject(ctx, {
    title: `شبكة محلية ولاسلكية لمبنى إداري ${DEMO_MARK}`,
    client: 'جهة حكومية (بيانات توضيحية)', sector: 'تقنية المعلومات', valueBand: '١–٣ مليون ريال',
    startedAt: new Date(now - 820 * DAY), endedAt: new Date(now - 730 * DAY),
    description: 'تمديد ٤٢٠ نقطة شبكة، مبدّلات مُدارة، غرفة اتصالات، شبكة لاسلكية، اختبار قبول وتدريب.',
    documentId: docIds.reference,
  });
  await addPastProject(ctx, {
    title: `بوابة خدمات داخلية لجهة شبه حكومية ${DEMO_MARK}`,
    client: 'جهة شبه حكومية (بيانات توضيحية)', sector: 'تقنية المعلومات', valueBand: 'أقل من مليون ريال',
    startedAt: new Date(now - 400 * DAY), endedAt: new Date(now - 250 * DAY),
    description: 'تطوير بوابة طلبات داخلية مع تسجيل دخول موحّد وتقارير.',
  });

  // The user pressed the button: that is the human statement that this
  // (sample) profile is what the analysis should rely on.
  await confirmProfile(ctx);

  const discovery = await discover(ctx, {});
  const tender = await s.from('tenders').select(['id'])
    .where('source_ref' as never, '=', 'DEMO-0001' as never).executeTakeFirst();
  if (!tender) throw new AppError('INTERNAL', 'The sample tenders could not be loaded.');
  const tenderId = (tender as { id: string }).id;

  await uploadTenderDocument(ctx, tenderId, {
    title: `كراسة الشروط والمواصفات ${DEMO_MARK}`, mimeType: 'text/plain', bytes: txt(TENDER_BOOKLET),
  });

  const aiConnected = aiState() === 'CONNECTED';
  let analysisId: string | null = null;
  if (aiConnected) {
    analysisId = (await startAnalysis(ctx, tenderId)).analysisId;
  }

  await notify(ctx, {
    kind: 'NEW_OPPORTUNITY',
    title: 'حُمّلت البيانات التجريبية',
    body: aiConnected
      ? 'بدأ تحليل حقيقي لمنافسة الشبكة التجريبية — الوكلاء يعملون الآن على هذه البيانات.'
      : 'لا يوجد مزوّد ذكاء اصطناعي مُهيّأ، فلم يبدأ أي تحليل.',
    link: analysisId ? `/app/analysis/${analysisId}` : `/app/opportunities/${tenderId}`,
  });
  await audit(ctx, 'demo.load', { type: 'tender', id: tenderId }, {
    tendersImported: discovery.imported, analysisId,
  });

  return { tenderId, analysisId, aiConnected, tendersImported: discovery.imported };
}
