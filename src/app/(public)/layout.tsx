import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/how-it-works', label: 'كيف تعمل' },
  { href: '/about', label: 'عن رَصْد' },
  { href: '/pricing', label: 'الأسعار' },
  { href: '/contact', label: 'تواصل' },
];

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-white/[.06] bg-charcoal/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-6 py-5">
          <Link href="/" className="flex items-baseline gap-2.5">
            <span className="text-xl font-semibold">RASD</span>
            <span className="text-lg font-light text-blue-soft">رَصْد</span>
          </Link>
          <div className="hidden items-center gap-8 text-sm text-muted lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="transition-colors hover:text-ink">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-quiet text-sm">
              دخول
            </Link>
            <Link href="/demo" className="btn-primary text-sm">
              اطلب عرضاً
            </Link>
          </div>
        </div>
      </nav>

      {children}

      <footer className="relative mt-20 overflow-hidden border-t border-white/[.06] pb-12 pt-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col justify-between gap-14 lg:flex-row">
            <div className="max-w-sm">
              <div className="flex items-baseline gap-2.5">
                <span className="text-xl font-semibold">RASD</span>
                <span className="text-lg font-light text-blue-soft">رَصْد</span>
              </div>
              <p className="mt-5 text-sm text-muted">
                منصة ذكاء اصطناعي وكيلي للمنافسات الحكومية: اكتشاف، وفهم، وتقييم، وإعداد — بقرار بشري
                في كل خطوة حاسمة.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
              <div>
                <h4 className="lbl text-[11px]">المنصة</h4>
                <ul className="mt-5 space-y-3 text-muted">
                  {NAV.map((n) => (
                    <li key={n.href}>
                      <Link href={n.href} className="transition-colors hover:text-ink">{n.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="lbl text-[11px]">الحساب</h4>
                <ul className="mt-5 space-y-3 text-muted">
                  <li><Link href="/login" className="hover:text-ink">تسجيل الدخول</Link></li>
                  <li><Link href="/register" className="hover:text-ink">إنشاء مساحة عمل</Link></li>
                  <li><Link href="/demo" className="hover:text-ink">طلب عرض تجريبي</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="lbl text-[11px]">التواصل</h4>
                <ul className="mt-5 space-y-3 text-muted">
                  <li dir="ltr">hello@rasd.sa</li>
                  <li>الرياض · جازان</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-20 select-none" aria-hidden>
            <h2 className="text-[17vw] font-bold leading-[.8] text-white/[.045]">RASD</h2>
          </div>

          <div className="mt-10 flex flex-col justify-between gap-4 text-xs text-muted/50 sm:flex-row">
            <span>© {new Date().getFullYear()} رَصْد. جميع الحقوق محفوظة.</span>
            <span>رَصْد لا يضمن الأهلية أو الفوز بأي منافسة، ولا يقدّم أي عرض حكومي تلقائياً.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
