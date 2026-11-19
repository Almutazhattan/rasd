'use client';

/**
 * One-click sample workspace: loads a labelled sample company, its documents
 * and the sample tenders, then opens the real analysis the agents start on.
 */
import { useRouter } from 'next/navigation';
import { FormError, useSubmit } from './forms';

export function DemoWorkspaceCard({ aiConnected }: { aiConnected: boolean }) {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();

  return (
    <div className="glass relative overflow-hidden rounded-2xl border border-blue/30 p-7">
      <div className="pointer-events-none absolute -top-24 end-0 h-56 w-56 rounded-full bg-blue/20 blur-3xl" aria-hidden />
      <div className="relative">
        <span className="chip border border-sand/35 text-[11px] text-sand">بيانات تجريبية</span>
        <h2 className="mt-4 text-2xl">جرّب رَصْد بالكامل خلال دقيقة</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          نُحمّل لك منشأة تقنية تجريبية بملفها ووثائقها وشهاداتها ومشاريعها، ومنافسات توضيحية بكراسة شروط،
          {aiConnected
            ? ' ثم يبدأ الوكلاء تحليلاً حقيقياً لأول منافسة أمامك: المتطلبات، التوافق، الالتزام، المخاطر، والتوصية.'
            : ' ثم تستعرض كل الشاشات. (تشغيل الوكلاء يحتاج مزوّد ذكاء اصطناعي مُهيّأ.)'}
        </p>
        <p className="mt-3 text-xs text-muted/70">
          كل سجل تجريبي موسوم بوضوح، ولا يمثّل منشأة أو منافسة حقيقية. التحليل نفسه حقيقي: لا نتائج جاهزة مسبقاً.
        </p>
        <FormError error={error} />
        <button
          type="button"
          className="btn-primary mt-6"
          disabled={busy}
          onClick={() =>
            submit('/api/demo-workspace', 'POST', undefined, {
              onSuccess: (data) => {
                const d = data as { analysisId: string | null; tenderId: string };
                router.push(d.analysisId ? `/app/analysis/${d.analysisId}` : `/app/opportunities/${d.tenderId}`);
                router.refresh();
              },
            })
          }
        >
          {busy ? 'جارٍ تجهيز البيانات التجريبية…' : 'حمّل البيانات التجريبية وابدأ'}
        </button>
      </div>
    </div>
  );
}
