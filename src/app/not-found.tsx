import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="lbl text-[11px] tracking-[.22em] text-blue/90">404</p>
        <h1 className="mt-5 text-3xl">الصفحة غير موجودة</h1>
        <p className="mt-5 text-sm text-muted">
          قد يكون الرابط قديماً، أو أن السجل المطلوب لا ينتمي إلى مساحة عملك — وفي الحالتين لا نكشف
          وجوده.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link href="/app/dashboard" className="btn-primary">إلى اللوحة</Link>
          <Link href="/" className="btn-ghost">الصفحة الرئيسية</Link>
        </div>
      </div>
    </main>
  );
}
