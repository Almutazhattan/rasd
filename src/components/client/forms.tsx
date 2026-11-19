'use client';

/**
 * Client forms. One submit helper for all of them, so every form reports the
 * API's own error message instead of a generic failure — including the
 * field-level messages the handler returns for a validation error.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

interface ApiError {
  code: string;
  message: string;
  fields?: { path: string; message: string }[];
}

async function send(
  url: string, method: string, payload?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: ApiError }> {
  const res = await fetch(url, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: unknown; error?: ApiError }
    | null;
  if (!json) {
    return { ok: false, error: { code: 'INTERNAL', message: 'تعذّر قراءة استجابة الخادم.' } };
  }
  if (!res.ok || !json.ok) {
    return { ok: false, error: json.error ?? { code: 'INTERNAL', message: 'حدث خطأ غير متوقع.' } };
  }
  return { ok: true, data: json.data };
}

export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(
    url: string, method: string, payload?: unknown,
    opts: { onSuccess?: (data: unknown) => void; successMessage?: string } = {},
  ) {
    setBusy(true);
    setError(null);
    setDone(null);
    const result = await send(url, method, payload);
    setBusy(false);
    if (result.ok) {
      if (opts.successMessage) setDone(opts.successMessage);
      opts.onSuccess?.(result.data);
    } else {
      setError(result.error);
    }
    return result;
  }

  return { busy, error, done, submit, setError };
}

export function FormError({ error }: { error: { message: string; fields?: { path: string; message: string }[] } | null }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-danger/35 bg-danger/[.07] p-4 text-sm">
      <p className="text-ink">{error.message}</p>
      {error.fields?.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {error.fields.map((f) => (
            <li key={f.path}>
              {f.path}: {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FormOk({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-ok/30 bg-ok/[.07] p-4 text-sm text-ink">{message}</div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-2 block text-xs text-muted/70">{hint}</span>}
    </label>
  );
}

// ───────────────────────────── auth ─────────────────────────────

export function LoginForm() {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit('/api/auth/login', 'POST', { email, password }, {
          onSuccess: () => router.push('/app/dashboard'),
        });
      }}
    >
      <FormError error={error} />
      <Field label="البريد الإلكتروني">
        <input
          className="input" type="email" dir="ltr" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="كلمة المرور">
        <input
          className="input" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
      </button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit('/api/auth/register', 'POST', form, {
          onSuccess: () => router.push('/onboarding'),
        });
      }}
    >
      <FormError error={error} />
      <Field label="اسم المنشأة">
        <input className="input" required value={form.orgName} onChange={set('orgName')} />
      </Field>
      <Field label="اسمك">
        <input className="input" required value={form.name} onChange={set('name')} />
      </Field>
      <Field label="البريد الإلكتروني للعمل">
        <input className="input" type="email" dir="ltr" required autoComplete="email"
          value={form.email} onChange={set('email')} />
      </Field>
      <Field label="كلمة المرور" hint="عشرة أحرف على الأقل.">
        <input className="input" type="password" required minLength={10} autoComplete="new-password"
          value={form.password} onChange={set('password')} />
      </Field>
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? 'جارٍ إنشاء مساحة العمل…' : 'إنشاء الحساب ومساحة العمل'}
      </button>
      <p className="text-xs text-muted/70">
        لا نطلب بيانات حساسة في هذه المرحلة. يمكنك رفع وثائق المنشأة لاحقاً من داخل المنصة.
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { busy, error, done, submit } = useSubmit();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await submit('/api/auth/forgot-password', 'POST', { email }, {
          successMessage: 'تم استلام الطلب.',
        });
        if (r.ok) setNote((r.data as { note?: string }).note ?? null);
      }}
    >
      <FormError error={error} />
      <FormOk message={done} />
      {note && <p className="text-xs text-muted">{note}</p>}
      <Field label="البريد الإلكتروني">
        <input className="input" type="email" dir="ltr" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? 'جارٍ الإرسال…' : 'أرسل رابط إعادة التعيين'}
      </button>
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const { busy, submit } = useSubmit();
  return (
    <button
      className="btn-quiet text-xs"
      disabled={busy}
      onClick={async () => {
        await submit('/api/auth/logout', 'POST');
        router.push('/login');
      }}
    >
      {busy ? '…' : 'خروج'}
    </button>
  );
}

// ───────────────────────── company profile ─────────────────────────

const LIST_FIELDS = ['industries', 'activities', 'services', 'regions'] as const;

export function ProfileForm({ initial }: { initial: Record<string, unknown> | null }) {
  const router = useRouter();
  const { busy, error, done, submit } = useSubmit();
  const [form, setForm] = useState({
    legalName: String(initial?.legal_name ?? ''),
    crNumber: String(initial?.cr_number ?? ''),
    sizeBand: String(initial?.size_band ?? ''),
    employeeCount: initial?.employee_count ? String(initial.employee_count) : '',
    annualRevenueBand: String(initial?.annual_revenue_band ?? ''),
    bondingCapacity: String(initial?.bonding_capacity ?? ''),
    summary: String(initial?.summary ?? ''),
    industries: ((initial?.industries as string[]) ?? []).join(', '),
    activities: ((initial?.activities as string[]) ?? []).join(', '),
    services: ((initial?.services as string[]) ?? []).join(', '),
    regions: ((initial?.regions as string[]) ?? []).join(', '),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <form
      className="space-y-7"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit('/api/company/profile', 'PUT', {
          legalName: form.legalName,
          crNumber: form.crNumber || null,
          sizeBand: form.sizeBand || null,
          employeeCount: form.employeeCount ? Number(form.employeeCount) : null,
          annualRevenueBand: form.annualRevenueBand || null,
          bondingCapacity: form.bondingCapacity || null,
          summary: form.summary || null,
          industries: split(form.industries),
          activities: split(form.activities),
          services: split(form.services),
          regions: split(form.regions),
        }, { successMessage: 'حُفظت البيانات. تحتاج تأكيداً بشرياً قبل الاعتماد عليها في التحليل.', onSuccess: () => router.refresh() });
      }}
    >
      <FormError error={error} />
      <FormOk message={done} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="الاسم النظامي للمنشأة">
          <input className="input" required value={form.legalName} onChange={set('legalName')} />
        </Field>
        <Field label="رقم السجل التجاري" hint="اختياري.">
          <input className="input" dir="ltr" value={form.crNumber} onChange={set('crNumber')} />
        </Field>
        <Field label="حجم المنشأة">
          <select className="input" value={form.sizeBand} onChange={set('sizeBand')}>
            <option value="">—</option>
            <option value="micro">متناهية الصغر</option>
            <option value="small">صغيرة</option>
            <option value="medium">متوسطة</option>
            <option value="large">كبيرة</option>
          </select>
        </Field>
        <Field label="عدد العاملين">
          <input className="input tnum" type="number" min={0} value={form.employeeCount} onChange={set('employeeCount')} />
        </Field>
        <Field label="نطاق الإيراد السنوي" hint="نطاق، لا رقم محدد.">
          <input className="input" value={form.annualRevenueBand} onChange={set('annualRevenueBand')} />
        </Field>
        <Field label="القدرة على إصدار الضمانات">
          <input className="input" value={form.bondingCapacity} onChange={set('bondingCapacity')} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {LIST_FIELDS.map((key) => (
          <Field
            key={key}
            label={
              key === 'industries' ? 'القطاعات' :
              key === 'activities' ? 'الأنشطة' :
              key === 'services' ? 'الخدمات والمنتجات' : 'النطاق الجغرافي'
            }
            hint="افصل بينها بفاصلة."
          >
            <input className="input" value={form[key]} onChange={set(key)} />
          </Field>
        ))}
      </div>

      <Field label="نبذة عن المنشأة">
        <textarea className="input min-h-28" value={form.summary} onChange={set('summary')} />
      </Field>

      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'جارٍ الحفظ…' : 'حفظ بيانات المنشأة'}
      </button>
    </form>
  );
}

export function ConfirmProfileButton({ confirmed }: { confirmed: boolean }) {
  const router = useRouter();
  const { busy, submit, error } = useSubmit();
  return (
    <div className="space-y-3">
      <FormError error={error} />
      <button
        className={confirmed ? 'btn-ghost' : 'btn-primary'}
        disabled={busy}
        onClick={async () => {
          await submit('/api/company/confirm', 'POST', undefined, { onSuccess: () => router.refresh() });
        }}
      >
        {busy ? '…' : confirmed ? 'إعادة التأكيد' : 'أؤكد صحة هذه البيانات'}
      </button>
    </div>
  );
}

// ───────────────────────── actions on records ─────────────────────────

export function RunAnalysisButton({ tenderId, label = 'ابدأ التحليل' }: { tenderId: string; label?: string }) {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  return (
    <div className="space-y-3">
      <FormError error={error} />
      <button
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          await submit('/api/analyses', 'POST', { tenderId }, {
            onSuccess: (data) => {
              const id = (data as { analysisId?: string }).analysisId;
              if (id) router.push(`/app/analysis/${id}`);
              else router.refresh();
            },
          });
        }}
      >
        {busy ? 'جارٍ الإضافة إلى الطابور…' : label}
      </button>
    </div>
  );
}

export function DiscoverButton() {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <FormError error={error} />
      {summary && <p className="text-xs text-muted">{summary}</p>}
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={async () => {
          const r = await submit('/api/tenders/discover', 'POST', { background: false });
          if (r.ok) {
            const d = r.data as {
              imported: number; updated: number; skipped: number;
              notes: { provider: string; state: string; note: string | null }[];
            };
            setSummary(
              `أُضيفت ${d.imported} · حُدِّثت ${d.updated} · تُركت ${d.skipped}. ` +
              d.notes.filter((n) => n.note).map((n) => `${n.provider}: ${n.note}`).join(' | '),
            );
            router.refresh();
          }
        }}
      >
        {busy ? 'جارٍ البحث في المصادر…' : 'اكتشف فرصاً من المصادر'}
      </button>
    </div>
  );
}

export function BookmarkButton({ tenderId, bookmarked }: { tenderId: string; bookmarked: boolean }) {
  const router = useRouter();
  const { busy, submit } = useSubmit();
  return (
    <button
      className="btn-ghost text-xs"
      disabled={busy}
      onClick={async () => {
        await submit(`/api/tenders/${tenderId}/bookmark`, 'POST', undefined, {
          onSuccess: () => router.refresh(),
        });
      }}
    >
      {bookmarked ? 'إزالة من المحفوظات' : 'حفظ الفرصة'}
    </button>
  );
}

export function ApprovalDecision({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);

  const decide = async (status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED') => {
    await submit(`/api/approvals/${requestId}`, 'POST', { status, comment: comment || undefined }, {
      onSuccess: () => router.refresh(),
    });
  };

  return (
    <div className="space-y-3">
      <FormError error={error} />
      {open && (
        <textarea
          className="input min-h-20 text-sm"
          placeholder="سبب الرفض أو التعديل المطلوب — إلزامي عند الرفض."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary text-xs" disabled={busy} onClick={() => decide('APPROVED')}>
          اعتماد
        </button>
        <button
          className="btn-ghost text-xs"
          disabled={busy}
          onClick={() => (open ? decide('CHANGES_REQUESTED') : setOpen(true))}
        >
          طلب تعديل
        </button>
        <button
          className="btn-danger text-xs"
          disabled={busy}
          onClick={() => (open ? decide('REJECTED') : setOpen(true))}
        >
          رفض
        </button>
      </div>
    </div>
  );
}

export function CreateDraftButton({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const { busy, error, submit, done } = useSubmit();
  return (
    <div className="space-y-3">
      <FormError error={error} />
      <FormOk message={done} />
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={async () => {
          await submit('/api/drafts', 'POST', { analysisId, background: true }, {
            successMessage: 'أُضيفت مهمة إعداد المسودة إلى الطابور. ستظهر في مساحة العروض عند اكتمالها.',
            onSuccess: () => router.refresh(),
          });
        }}
      >
        {busy ? '…' : 'أعِدّ مسودة عرض'}
      </button>
    </div>
  );
}

export function SectionEditor({
  draftId, sectionId, heading, body,
}: { draftId: string; sectionId: string; heading: string; body: string }) {
  const router = useRouter();
  const { busy, error, done, submit } = useSubmit();
  const [text, setText] = useState(body);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm text-muted">{text || '— لا نص بعد —'}</p>
        <button className="btn-quiet text-xs" onClick={() => setEditing(true)}>
          تحرير القسم
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FormError error={error} />
      <FormOk message={done} />
      <textarea className="input min-h-48 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-3">
        <button
          className="btn-primary text-xs"
          disabled={busy}
          onClick={async () => {
            await submit(`/api/drafts/${draftId}/sections`, 'PATCH', { sectionId, body: text, heading }, {
              successMessage: 'حُفظ القسم. التحرير بعد الاعتماد يُعيد المسودة إلى المراجعة.',
              onSuccess: () => router.refresh(),
            });
            setEditing(false);
          }}
        >
          حفظ
        </button>
        <button className="btn-quiet text-xs" onClick={() => { setText(body); setEditing(false); }}>
          إلغاء
        </button>
      </div>
    </div>
  );
}

export function UploadDocument({ endpoint, kinds }: { endpoint: string; kinds?: { value: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true); setError(null); setMessage(null);
        const res = await fetch(endpoint, { method: 'POST', body: form });
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; data?: { readable?: boolean; chunks?: number; note?: string | null }; error?: { message: string } }
          | null;
        setBusy(false);
        if (!res.ok || !json?.ok) {
          setError(json?.error?.message ?? 'تعذّر رفع الملف.');
          return;
        }
        const d = json.data ?? {};
        setMessage(
          d.readable
            ? `تم الرفع واستخراج ${d.chunks ?? 0} مقطعاً نصياً مع مراجع الصفحات.`
            : d.note ?? 'تم الرفع، لكن لم يُستخرج نصّ من الملف.',
        );
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }}
    >
      {error && <div className="rounded-xl border border-danger/35 bg-danger/[.07] p-4 text-sm">{error}</div>}
      {message && <div className="rounded-xl border border-blue/30 bg-blue/[.07] p-4 text-sm">{message}</div>}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="عنوان الوثيقة">
          <input className="input" name="title" required />
        </Field>
        {kinds && (
          <Field label="النوع">
            <select className="input" name="kind" defaultValue={kinds[0]?.value}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="الملف" hint="PDF أو DOCX أو XLSX أو صورة — 25 ميجابايت كحد أقصى.">
          <input className="input" type="file" name="file" required
            accept=".pdf,.docx,.xlsx,.doc,.png,.jpg,.jpeg,.txt" />
        </Field>
        {kinds && (
          <Field label="تاريخ الانتهاء" hint="للشهادات — ننبّهك قبل انتهائها.">
            <input className="input" type="date" name="expiresAt" dir="ltr" />
          </Field>
        )}
      </div>

      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'جارٍ الرفع والاستخراج…' : 'رفع الوثيقة'}
      </button>
    </form>
  );
}

export function WeightsForm({ initial }: { initial: Record<string, number> }) {
  const router = useRouter();
  const { busy, error, done, submit } = useSubmit();
  const [w, setW] = useState(initial);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const labels: Record<string, string> = {
    technicalFit: 'الملاءمة الفنية',
    experience: 'الخبرة السابقة',
    complianceReadiness: 'جاهزية الالتزام',
    resources: 'الموارد',
    financialReadiness: 'الجاهزية المالية',
    geographic: 'النطاق الجغرافي',
  };

  return (
    <form
      className="space-y-7"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit('/api/settings/weights', 'PUT', w, {
          successMessage: 'حُدِّثت الأوزان. تُطبَّق على التحليلات القادمة؛ التحليلات السابقة تحتفظ بأوزانها المسجّلة.',
          onSuccess: () => router.refresh(),
        });
      }}
    >
      <FormError error={error} />
      <FormOk message={done} />
      <div className="space-y-5">
        {Object.keys(labels).map((key) => (
          <div key={key}>
            <div className="flex items-baseline justify-between text-sm">
              <span>{labels[key]}</span>
              <span className="tnum text-muted">{w[key] ?? 0}</span>
            </div>
            <input
              className="mt-2 w-full accent-[color:var(--blue)]"
              type="range" min={0} max={50} value={w[key] ?? 0}
              onChange={(e) => setW((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        المجموع الحالي {total}. لا يلزم أن يساوي ١٠٠ — يُطبِّع المحرك الأوزان نسبياً ويحفظ المنهجية مع كل تحليل.
      </p>
      <button className="btn-primary" disabled={busy || total <= 0} type="submit">
        {busy ? '…' : 'حفظ الأوزان'}
      </button>
    </form>
  );
}

export function InviteForm({ roles }: { roles: { value: string; label: string }[] }) {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[0]?.value ?? 'MEMBER');
  const [token, setToken] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await submit('/api/team/invite', 'POST', { email, role });
        if (r.ok) {
          setToken((r.data as { inviteToken?: string }).inviteToken ?? null);
          setEmail('');
          router.refresh();
        }
      }}
    >
      <FormError error={error} />
      {token && (
        <div className="rounded-xl border border-sand/35 bg-sand/[.07] p-4 text-xs">
          <p className="text-ink">البريد غير مُهيّأ في هذا النشر، فلم تُرسل رسالة. أرسل هذا الرمز للمدعو بنفسك:</p>
          <code className="mt-2 block break-all text-muted" dir="ltr">{token}</code>
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-[1fr,auto,auto] sm:items-end">
        <Field label="البريد الإلكتروني">
          <input className="input" type="email" dir="ltr" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="الدور">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>
        <button className="btn-primary" disabled={busy} type="submit">
          {busy ? '…' : 'إرسال الدعوة'}
        </button>
      </div>
    </form>
  );
}

export function MarkNotificationsRead() {
  const router = useRouter();
  const { busy, submit } = useSubmit();
  return (
    <button
      className="btn-ghost text-xs"
      disabled={busy}
      onClick={async () => {
        await submit('/api/notifications', 'PATCH', { markAll: true }, { onSuccess: () => router.refresh() });
      }}
    >
      {busy ? '…' : 'تعليم الكل كمقروء'}
    </button>
  );
}

export function Refresher({ seconds = 6, stopAfterMs = 600_000 }: { seconds?: number; stopAfterMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > stopAfterMs) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds, stopAfterMs]);
  return <span className="text-xs text-muted/60">تُحدَّث الصفحة تلقائياً كل {seconds} ثوانٍ…</span>;
}
