'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError, FormOk, useSubmit } from './forms';

type Tab = 'capability' | 'certification' | 'project';

export function ChildRecordForms() {
  const router = useRouter();
  const { busy, error, done, submit } = useSubmit();
  const [tab, setTab] = useState<Tab>('capability');

  const [cap, setCap] = useState({ label: '', level: 3 });
  const [cert, setCert] = useState({ name: '', issuer: '', number: '', expiresAt: '' });
  const [proj, setProj] = useState({ title: '', client: '', sector: '', valueBand: '', description: '' });

  const after = { onSuccess: () => router.refresh(), successMessage: 'أُضيف السجل.' };

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap gap-2">
        {([
          ['capability', 'قدرة'],
          ['certification', 'شهادة'],
          ['project', 'مشروع مرجعي'],
        ] as [Tab, string][]).map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'btn-primary px-4 py-2 text-xs' : 'btn-ghost px-4 py-2 text-xs'}
            onClick={() => setTab(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <FormError error={error} />
      <FormOk message={done} />

      {tab === 'capability' && (
        <form
          className="grid gap-5 sm:grid-cols-[1fr,auto,auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await submit('/api/company/capabilities', 'POST', cap, after);
            if (r.ok) setCap({ label: '', level: 3 });
          }}
        >
          <label><span className="label">القدرة</span>
            <input className="input" required value={cap.label}
              onChange={(e) => setCap((c) => ({ ...c, label: e.target.value }))} /></label>
          <label><span className="label">المستوى</span>
            <select className="input" value={cap.level}
              onChange={(e) => setCap((c) => ({ ...c, level: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select></label>
          <button className="btn-primary" disabled={busy} type="submit">إضافة</button>
        </form>
      )}

      {tab === 'certification' && (
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await submit('/api/company/certifications', 'POST', {
              name: cert.name,
              issuer: cert.issuer || null,
              number: cert.number || null,
              expiresAt: cert.expiresAt || null,
            }, after);
            if (r.ok) setCert({ name: '', issuer: '', number: '', expiresAt: '' });
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label><span className="label">اسم الشهادة</span>
              <input className="input" required value={cert.name}
                onChange={(e) => setCert((c) => ({ ...c, name: e.target.value }))} /></label>
            <label><span className="label">الجهة المانحة</span>
              <input className="input" value={cert.issuer}
                onChange={(e) => setCert((c) => ({ ...c, issuer: e.target.value }))} /></label>
            <label><span className="label">الرقم</span>
              <input className="input" dir="ltr" value={cert.number}
                onChange={(e) => setCert((c) => ({ ...c, number: e.target.value }))} /></label>
            <label><span className="label">تاريخ الانتهاء</span>
              <input className="input" type="date" dir="ltr" value={cert.expiresAt}
                onChange={(e) => setCert((c) => ({ ...c, expiresAt: e.target.value }))} /></label>
          </div>
          <button className="btn-primary" disabled={busy} type="submit">إضافة الشهادة</button>
        </form>
      )}

      {tab === 'project' && (
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await submit('/api/company/projects', 'POST', {
              title: proj.title,
              client: proj.client || null,
              sector: proj.sector || null,
              valueBand: proj.valueBand || null,
              description: proj.description || null,
            }, after);
            if (r.ok) setProj({ title: '', client: '', sector: '', valueBand: '', description: '' });
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label><span className="label">عنوان المشروع</span>
              <input className="input" required value={proj.title}
                onChange={(e) => setProj((p) => ({ ...p, title: e.target.value }))} /></label>
            <label><span className="label">العميل</span>
              <input className="input" value={proj.client}
                onChange={(e) => setProj((p) => ({ ...p, client: e.target.value }))} /></label>
            <label><span className="label">القطاع</span>
              <input className="input" value={proj.sector}
                onChange={(e) => setProj((p) => ({ ...p, sector: e.target.value }))} /></label>
            <label><span className="label">نطاق القيمة</span>
              <input className="input" value={proj.valueBand}
                onChange={(e) => setProj((p) => ({ ...p, valueBand: e.target.value }))}
                placeholder="نطاق، لا رقم محدد" /></label>
          </div>
          <label className="block"><span className="label">الوصف</span>
            <textarea className="input min-h-24" value={proj.description}
              onChange={(e) => setProj((p) => ({ ...p, description: e.target.value }))} /></label>
          <button className="btn-primary" disabled={busy} type="submit">إضافة المشروع</button>
        </form>
      )}
    </div>
  );
}
