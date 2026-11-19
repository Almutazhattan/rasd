import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-6 py-20">
      <div className="aurora" aria-hidden>
        <span className="blade blade-1" />
        <span className="blade blade-3" />
        <div className="grain" />
        <div className="vignette" />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <Link href="/" className="mb-10 flex items-baseline justify-center gap-2.5">
          <span className="text-2xl font-semibold">RASD</span>
          <span className="text-xl font-light text-blue-soft">رَصْد</span>
        </Link>
        <div className="glass rounded-2xl p-7 sm:p-10">{children}</div>
      </div>
    </div>
  );
}
