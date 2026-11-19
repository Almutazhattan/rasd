'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError, useSubmit } from './forms';

export function ManualTenderForm() {
  const router = useRouter();
  const { busy, error, submit } = useSubmit();
  const [form, setForm] = useState({
    title: '', entity: '', referenceNo: '', sector: '', region: '',
    closesAt: '', estimatedValueBand: '', summary: '', scopeOfWork: '',
  });
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await submit('/api/tenders', 'POST', {
          title: form.title,
          entity: form.entity,
          referenceNo: form.referenceNo || null,
          sector: form.sector || null,
          region: form.region || null,
          closesAt: form.closesAt || null,
          estimatedValueBand: form.estimatedValueBand || null,
          summary: form.summary || null,
          scopeOfWork: form.scopeOfWork || null,
        });
        if (r.ok) {
          const id = (r.data as { id: string }).id;
          router.push(`/app/opportunities/${id}`);
        }
      }}
    >
      <FormError error={error} />
      <div className="grid gap-5 sm:grid-cols-2">
        <label><span className="label">عنوان المنافسة</span>
          <input className="input" required value={form.title} onChange={set('title')} /></label>
        <label><span className="label">الجهة الحكومية</span>
          <input className="input" required value={form.entity} onChange={set('entity')} /></label>
        <label><span className="label">الرقم المرجعي</span>
          <input className="input" dir="ltr" value={form.referenceNo} onChange={set('referenceNo')} /></label>
        <label><span className="label">تاريخ الإغلاق</span>
          <input className="input" type="date" dir="ltr" value={form.closesAt} onChange={set('closesAt')} /></label>
        <label><span className="label">القطاع</span>
          <input className="input" value={form.sector} onChange={set('sector')} /></label>
        <label><span className="label">المنطقة</span>
          <input className="input" value={form.region} onChange={set('region')} /></label>
      </div>
      <label className="block"><span className="label">نطاق العمل</span>
        <textarea className="input min-h-32" value={form.scopeOfWork} onChange={set('scopeOfWork')}
          placeholder="الصق نص نطاق العمل والمتطلبات — يستخدمه وكيل فهم الوثائق." /></label>
      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? '…' : 'إضافة المنافسة'}
      </button>
    </form>
  );
}
