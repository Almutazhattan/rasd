/**
 * The shared component vocabulary. Server components by default; anything that
 * needs state lives in src/components/client/.
 *
 * Two of these carry product meaning rather than decoration:
 *   • <Provenance> renders where a fact came from, so a verified claim and an
 *     inference never look the same on screen.
 *   • <ScoreRing> always shows blocking gaps beside the number, because a score
 *     shown alone is the thing this product exists not to do.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AnalysisStatus, ApprovalStatus, ComplianceStatus, Provenance as Prov, RunStatus, Severity, Verdict } from '@/lib/db/types';
import { VERDICT_LABELS } from '@/lib/scoring';

// ───────────────────────────── layout ─────────────────────────────

export function Card({
  children, className = '', as: As = 'section',
}: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={`glass rounded-2xl p-7 ${className}`}>{children}</As>;
}

export function PageHeader({
  title, kicker, lead, actions,
}: { title: string; kicker?: string; lead?: string; actions?: ReactNode }) {
  return (
    <header className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          {kicker && <p className="lbl text-[11px] uppercase tracking-[.22em] text-blue/90">{kicker}</p>}
          <h1 className="mt-5 text-3xl sm:text-4xl">{title}</h1>
          {lead && <p className="mt-3 text-muted">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      <div className="hair mt-7" />
    </header>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-14">
      <div className="mb-5 flex items-baseline justify-between gap-5">
        <h2 className="text-xl">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label, value, hint, tone = 'default',
}: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'warn' | 'danger' | 'ok' }) {
  const colour =
    tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-sand' : tone === 'ok' ? 'text-ok' : 'text-ink';
  return (
    <div className="glass rounded-2xl p-5">
      <div className="lbl text-[10px] tracking-[.16em]">{label}</div>
      <div className={`mt-3 text-3xl tnum ${colour}`}>{value}</div>
      {hint && <div className="mt-3 text-xs text-muted leading-relaxed">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="glass rounded-2xl p-10 text-center">
      <h3 className="text-lg">{title}</h3>
      <p className="mx-auto mt-3 max-w-xl text-sm text-muted">{body}</p>
      {action && <div className="mt-7 flex justify-center">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info', title, children,
}: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: string; children: ReactNode }) {
  const map = {
    info: 'border-blue/30 bg-blue/[.07] text-ink',
    warn: 'border-sand/35 bg-sand/[.07] text-ink',
    danger: 'border-danger/35 bg-danger/[.07] text-ink',
    ok: 'border-ok/30 bg-ok/[.07] text-ink',
  } as const;
  return (
    <div className={`rounded-2xl border p-5 text-sm ${map[tone]}`}>
      {title && <div className="mb-2 font-medium">{title}</div>}
      <div className="text-muted leading-relaxed">{children}</div>
    </div>
  );
}

// ───────────────────────────── meaning ─────────────────────────────

const PROVENANCE: Record<Prov, { label: string; className: string; hint: string }> = {
  VERIFIED: {
    label: 'مؤكد',
    className: 'border-ok/30 text-ok',
    hint: 'تدعمه وثيقة مرفوعة بمرجع صفحة',
  },
  USER_PROVIDED: {
    label: 'من المنشأة',
    className: 'border-blue/30 text-blue-soft',
    hint: 'أدخلته المنشأة ولم يُتحقَّق منه بوثيقة',
  },
  AI_INFERRED: {
    label: 'استنتاج آلي',
    className: 'border-sand/35 text-sand',
    hint: 'استنتجه وكيل من المعطيات، بدرجة ثقة',
  },
  MISSING: {
    label: 'ناقص',
    className: 'border-danger/35 text-danger',
    hint: 'مطلوب وغير متوفر — معروض ولم يُستكمل بافتراض',
  },
};

export function Provenance({ value, withHint = false }: { value: Prov; withHint?: boolean }) {
  const p = PROVENANCE[value];
  return (
    <span className={`chip border ${p.className}`} title={p.hint}>
      {p.label}
      {withHint && <span className="text-muted/70"> · {p.hint}</span>}
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(PROVENANCE) as Prov[]).map((k) => (
        <Provenance key={k} value={k} />
      ))}
    </div>
  );
}

export function VerdictBadge({ value }: { value: Verdict | null }) {
  if (!value) return <span className="chip border border-white/15 text-muted">لا توصية بعد</span>;
  const tone: Record<Verdict, string> = {
    STRONG_OPPORTUNITY: 'border-ok/35 text-ok',
    POTENTIAL_OPPORTUNITY: 'border-blue/35 text-blue-soft',
    REQUIRES_FURTHER_REVIEW: 'border-sand/40 text-sand',
    NOT_RECOMMENDED: 'border-danger/40 text-danger',
  };
  return <span className={`chip border ${tone[value]}`}>{VERDICT_LABELS[value].ar}</span>;
}

const ANALYSIS_STATUS: Record<AnalysisStatus, { label: string; className: string }> = {
  QUEUED: { label: 'في الانتظار', className: 'border-white/15 text-muted' },
  RUNNING: { label: 'قيد التنفيذ', className: 'border-blue/35 text-blue-soft' },
  NEEDS_HUMAN_REVIEW: { label: 'يحتاج مراجعة بشرية', className: 'border-sand/40 text-sand' },
  COMPLETE: { label: 'مكتمل', className: 'border-ok/30 text-ok' },
  FAILED: { label: 'فشل', className: 'border-danger/40 text-danger' },
  PROVIDER_UNCONFIGURED: { label: 'المزوّد غير مُهيّأ', className: 'border-sand/40 text-sand' },
};

export function AnalysisStatusBadge({ value }: { value: AnalysisStatus }) {
  const s = ANALYSIS_STATUS[value];
  return <span className={`chip border ${s.className}`}>{s.label}</span>;
}

const RUN_STATUS: Record<RunStatus, { label: string; className: string }> = {
  PENDING: { label: 'بانتظار', className: 'border-white/15 text-muted' },
  RUNNING: { label: 'يعمل', className: 'border-blue/35 text-blue-soft' },
  SUCCEEDED: { label: 'نجح', className: 'border-ok/30 text-ok' },
  FAILED: { label: 'فشل', className: 'border-danger/40 text-danger' },
  TIMED_OUT: { label: 'انتهت المهلة', className: 'border-danger/40 text-danger' },
  CANCELLED: { label: 'أُلغي', className: 'border-white/15 text-muted' },
  AWAITING_APPROVAL: { label: 'بانتظار موافقة', className: 'border-sand/40 text-sand' },
  PROVIDER_UNCONFIGURED: { label: 'المزوّد غير مُهيّأ', className: 'border-sand/40 text-sand' },
};

export function RunStatusBadge({ value }: { value: RunStatus }) {
  const s = RUN_STATUS[value];
  return <span className={`chip border ${s.className}`}>{s.label}</span>;
}

const COMPLIANCE: Record<ComplianceStatus, { label: string; className: string }> = {
  MET: { label: 'مستوفى', className: 'border-ok/30 text-ok' },
  PARTIAL: { label: 'جزئي', className: 'border-sand/35 text-sand' },
  NOT_MET: { label: 'غير مستوفى', className: 'border-danger/40 text-danger' },
  UNKNOWN: { label: 'غير محدَّد', className: 'border-white/20 text-muted' },
};

export function ComplianceBadge({ value }: { value: ComplianceStatus }) {
  const s = COMPLIANCE[value];
  return <span className={`chip border ${s.className}`}>{s.label}</span>;
}

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  LOW: { label: 'منخفضة', className: 'border-white/20 text-muted' },
  MEDIUM: { label: 'متوسطة', className: 'border-blue/30 text-blue-soft' },
  HIGH: { label: 'عالية', className: 'border-sand/40 text-sand' },
  CRITICAL: { label: 'حرجة', className: 'border-danger/40 text-danger' },
};

export function SeverityBadge({ value }: { value: Severity }) {
  const s = SEVERITY[value];
  return <span className={`chip border ${s.className}`}>{s.label}</span>;
}

const APPROVAL: Record<ApprovalStatus, { label: string; className: string }> = {
  PENDING: { label: 'بانتظار المراجعة', className: 'border-sand/40 text-sand' },
  APPROVED: { label: 'معتمد', className: 'border-ok/30 text-ok' },
  REJECTED: { label: 'مرفوض', className: 'border-danger/40 text-danger' },
  CHANGES_REQUESTED: { label: 'تعديلات مطلوبة', className: 'border-blue/35 text-blue-soft' },
  CANCELLED: { label: 'ملغى', className: 'border-white/15 text-muted' },
};

export function ApprovalBadge({ value }: { value: ApprovalStatus }) {
  const s = APPROVAL[value];
  return <span className={`chip border ${s.className}`}>{s.label}</span>;
}

/** Demonstration and unverified data are labelled wherever they appear. */
export function SourceBadge({
  isDemo, verification, sourceName,
}: { isDemo: boolean; verification: string; sourceName: string }) {
  if (isDemo) {
    return (
      <span className="chip border border-sand/40 text-sand" title="بيانات توضيحية موسومة — ليست منافسة حكومية قائمة">
        بيانات توضيحية
      </span>
    );
  }
  if (verification === 'UNVERIFIED') {
    return (
      <span className="chip border border-white/20 text-muted" title="أُدخلت يدوياً ولم تُطابق بمصدر رسمي">
        غير موثّقة · {sourceName}
      </span>
    );
  }
  return <span className="chip border border-ok/30 text-ok">مصدر رسمي · {sourceName}</span>;
}

export function IntegrationBadge({ state, label }: { state: string; label: string }) {
  const map: Record<string, string> = {
    CONNECTED: 'border-ok/30 text-ok',
    NOT_CONFIGURED: 'border-sand/40 text-sand',
    DEMO: 'border-sand/40 text-sand',
    DISABLED: 'border-white/15 text-muted',
  };
  const text: Record<string, string> = {
    CONNECTED: 'متصل',
    NOT_CONFIGURED: 'غير مُهيّأ',
    DEMO: 'وضع العرض',
    DISABLED: 'معطّل',
  };
  return (
    <span className={`chip border ${map[state] ?? 'border-white/15 text-muted'}`}>
      {label} · {text[state] ?? state}
    </span>
  );
}

// ───────────────────────────── figures ─────────────────────────────

/**
 * The score, never alone: blocking gaps sit beside it, and a capped verdict
 * says so. A 94 with an unmet mandatory requirement must not read as a 94.
 */
export function ScoreRing({
  score, blockingGaps = 0, size = 150, confidence,
}: { score: number | null; blockingGaps?: number; size?: number; confidence?: number | null }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const pct = score ?? 0;
  const offset = circumference - (circumference * pct) / 100;
  const stroke = blockingGaps > 0 ? 'var(--sand)' : 'var(--blue)';

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(163,157,144,.16)" strokeWidth="7" />
          {score !== null && (
            <circle
              cx="60" cy="60" r={r} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={offset}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-4xl font-light tnum">{score ?? '—'}</div>
            <div className="lbl mt-1 text-[10px]">درجة التوافق</div>
          </div>
        </div>
      </div>
      {blockingGaps > 0 ? (
        <span className="chip border border-danger/40 text-danger">
          {blockingGaps} متطلب إلزامي ناقص
        </span>
      ) : (
        <span className="chip border border-ok/25 text-ok/90">لا متطلبات إلزامية ناقصة</span>
      )}
      {typeof confidence === 'number' && (
        <span className="text-xs text-muted tnum">الثقة {(confidence * 100).toFixed(0)}%</span>
      )}
    </div>
  );
}

export function Meter({
  label, value, max = 100, tone,
}: { label: string; value: number; max?: number; tone?: 'blue' | 'sand' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colour = tone === 'sand' || value < 60 ? 'var(--sand)' : 'var(--blue)';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink/90">{label}</span>
        <span className="tnum text-muted">
          {value}
          <span className="text-xs text-muted/60">/{max}</span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[.07]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} />
      </div>
    </div>
  );
}

// ───────────────────────────── bits ─────────────────────────────

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`chip border border-white/15 text-muted ${className}`}>{children}</span>;
}

export function Breadcrumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="mb-7 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="مسار التنقل">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-2">
          {item.href ? (
            <Link href={item.href} className="transition-colors hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink/80">{item.label}</span>
          )}
          {i < items.length - 1 && <span className="text-muted/40">/</span>}
        </span>
      ))}
    </nav>
  );
}

export function DateText({ value, withTime = false }: { value: Date | string | null; withTime?: boolean }) {
  if (!value) return <span className="text-muted/60">—</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="text-muted/60">—</span>;
  const date = d.toISOString().slice(0, 10);
  return (
    <span className="tnum" dir="ltr">
      {withTime ? `${date} ${d.toISOString().slice(11, 16)}` : date}
    </span>
  );
}

export function DaysLeft({ value }: { value: Date | string | null }) {
  if (!value) return <span className="text-muted/60">لا تاريخ معلن</span>;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return <span className="text-muted/60">—</span>;
  if (days < 0) return <span className="text-muted">أُغلقت</span>;
  const tone = days <= 3 ? 'text-danger' : days <= 7 ? 'text-sand' : 'text-muted';
  return <span className={`tnum ${tone}`}>{days === 0 ? 'تُغلق اليوم' : `${days} يوم`}</span>;
}

/**
 * Loose row type for read models.
 *
 * The service layer returns rows shaped by the query, not by a single
 * interface. Pages render them field by field, so a permissive row type here
 * is honest about what is known — the alternative is a hand-written interface
 * per query that drifts from the SQL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
