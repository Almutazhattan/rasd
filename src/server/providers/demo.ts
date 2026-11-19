/**
 * Demonstration provider — labelled sample data for local development.
 *
 * Every record it returns is stored with source_kind = DEMO, verification =
 * DEMO_DATA and is_demo = true. The interface renders that label on every
 * surface a demo tender appears on, and the agents are told in their task
 * context that the record is sample data.
 *
 * The identifiers below are deliberately prefixed DEMO- and the entities are
 * generic descriptions rather than the names of real government bodies, so a
 * sample record cannot be mistaken for, or cited as, a real notice.
 */
import type {
  DiscoveryQuery, DiscoveryResult, NormalizedTender, ProcurementProvider, ProviderState,
} from './types';
import { env } from '@/lib/env';

const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY);

const SAMPLES: NormalizedTender[] = [
  {
    sourceRef: 'DEMO-0001',
    sourceUrl: null,
    title: 'توريد وتركيب شبكة حاسوبية لمبنى إداري',
    entity: 'جهة حكومية (بيانات توضيحية)',
    referenceNo: 'DEMO/NET/0001',
    sector: 'تقنية المعلومات',
    region: 'منطقة جازان',
    type: 'منافسة عامة',
    status: 'OPEN',
    publishedAt: day(-9),
    closesAt: day(18),
    estimatedValueBand: '١–٣ مليون ريال',
    bondRequired: true,
    summary:
      'توريد وتركيب شبكة محلية وأجهزة توجيه وتبديل لمبنى إداري من أربعة طوابق، مع الضمان والصيانة لسنتين.',
    scopeOfWork:
      'تمديد كوابل الشبكة، توريد مبدّلات وموجّهات مُدارة، إعداد غرفة الاتصالات، تهيئة الشبكة ' +
      'اللاسلكية، اختبار القبول، وتدريب فريق الجهة. شهادة أيزو ٢٧٠٠١ مطلوبة. خبرة في مشروعين ' +
      'مماثلين خلال خمس سنوات. خطاب ضمان ابتدائي بنسبة ٢٪.',
    submissionNotes: 'يُقدَّم العرض الفني والمالي في مظروفين منفصلين. بيانات توضيحية للتجربة فقط.',
    raw: { note: 'demonstration record — not a live tender' },
  },
  {
    sourceRef: 'DEMO-0002',
    sourceUrl: null,
    title: 'أعمال ترميم وصيانة لمجمّع تعليمي',
    entity: 'جهة حكومية (بيانات توضيحية)',
    referenceNo: 'DEMO/CIV/0002',
    sector: 'الإنشاءات والمقاولات',
    region: 'منطقة الرياض',
    type: 'منافسة عامة',
    status: 'OPEN',
    publishedAt: day(-3),
    closesAt: day(7),
    estimatedValueBand: '٥–١٠ مليون ريال',
    bondRequired: true,
    summary: 'ترميم واجهات، إعادة تأهيل أنظمة التكييف، وأعمال كهربائية لمجمّع تعليمي قائم.',
    scopeOfWork:
      'إزالة وإعادة تنفيذ الواجهات، استبدال وحدات التكييف، تحديث اللوحات الكهربائية، أعمال دهان ' +
      'وعزل. تصنيف مقاولين من الدرجة الرابعة أو أعلى في مجال المباني مطلوب. مدة التنفيذ ٢٤٠ يوماً.',
    submissionNotes: 'زيارة الموقع إلزامية قبل التقديم. بيانات توضيحية للتجربة فقط.',
    raw: { note: 'demonstration record — not a live tender' },
  },
  {
    sourceRef: 'DEMO-0003',
    sourceUrl: null,
    title: 'خدمات نقل وإمداد داخلي لمستودعات',
    entity: 'جهة حكومية (بيانات توضيحية)',
    referenceNo: 'DEMO/LOG/0003',
    sector: 'الخدمات اللوجستية',
    region: 'المنطقة الشرقية',
    type: 'منافسة محدودة',
    status: 'CLOSING_SOON',
    publishedAt: day(-21),
    closesAt: day(2),
    estimatedValueBand: 'أقل من مليون ريال',
    bondRequired: false,
    summary: 'تشغيل خدمات النقل الداخلي بين ثلاثة مستودعات، بأسطول وعمالة المتعهد.',
    scopeOfWork:
      'توفير ست شاحنات وسائقين، جدولة الرحلات اليومية، نظام تتبع إلكتروني، وتقارير شهرية. ' +
      'سجل تجاري ساري وشهادة الزكاة والتأمينات مطلوبة.',
    submissionNotes: 'بيانات توضيحية للتجربة فقط.',
    raw: { note: 'demonstration record — not a live tender' },
  },
  {
    sourceRef: 'DEMO-0004',
    sourceUrl: null,
    title: 'تطوير منصة إلكترونية للخدمات الداخلية',
    entity: 'جهة حكومية (بيانات توضيحية)',
    referenceNo: 'DEMO/SW/0004',
    sector: 'تقنية المعلومات',
    region: 'منطقة مكة المكرمة',
    type: 'منافسة عامة',
    status: 'OPEN',
    publishedAt: day(-1),
    closesAt: day(30),
    estimatedValueBand: '٣–٥ مليون ريال',
    bondRequired: true,
    summary: 'تحليل وتصميم وتطوير منصة خدمات داخلية مع تكامل مع أنظمة قائمة.',
    scopeOfWork:
      'تحليل المتطلبات، تصميم تجربة المستخدم، التطوير، التكامل عبر واجهات برمجية، اختبار الأمان، ' +
      'والتشغيل لمدة سنة. شهادة أيزو ٢٧٠٠١ وشهادة أيزو ٩٠٠١ مطلوبتان. فريق لا يقل عن ثمانية ' +
      'مختصين بالسيرة الذاتية.',
    submissionNotes: 'العرض الفني يُقيَّم بوزن ٧٠٪. بيانات توضيحية للتجربة فقط.',
    raw: { note: 'demonstration record — not a live tender' },
  },
];

export class DemoProvider implements ProcurementProvider {
  readonly key = 'demo';
  readonly label = { ar: 'مزوّد بيانات توضيحية', en: 'Demonstration data' };
  readonly sourceKind = 'DEMO' as const;
  readonly verification = 'DEMO_DATA' as const;
  readonly isDemo = true;

  state(): ProviderState {
    return env().ENABLE_DEMO_PROVIDER === 'true' ? 'CONNECTED' : 'DISABLED';
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    if (this.state() !== 'CONNECTED') {
      return { state: 'DISABLED', tenders: [], note: 'مزوّد البيانات التوضيحية معطّل.', fetchedAt: new Date() };
    }
    let out = SAMPLES;
    if (query.keywords?.length) {
      const needles = query.keywords.map((k) => k.toLowerCase());
      out = out.filter((t) =>
        needles.some((n) =>
          `${t.title} ${t.summary ?? ''} ${t.scopeOfWork ?? ''} ${t.sector ?? ''}`.toLowerCase().includes(n)),
      );
    }
    if (query.sectors?.length) out = out.filter((t) => t.sector && query.sectors!.includes(t.sector));
    if (query.regions?.length) out = out.filter((t) => t.region && query.regions!.includes(t.region));
    return {
      state: 'CONNECTED',
      tenders: out.slice(0, query.limit ?? 50),
      note:
        'هذه بيانات توضيحية موسومة، وليست منافسات حكومية قائمة. لا تُستخدم للقرارات، ' +
        'ولا تُعرض في أي موضع دون وسمها.',
      fetchedAt: new Date(),
    };
  }
}
