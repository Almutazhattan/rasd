'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The visitor sees a short message; the detail goes to the console and the
 * server log. An error page is not the place to print a stack trace.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('render error', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="lbl text-[11px] tracking-[.22em] text-sand">خطأ</p>
        <h1 className="mt-5 text-3xl">تعذّر إكمال العملية</h1>
        <p className="mt-5 text-sm text-muted">
          حدث خطأ غير متوقع. لم يُحفظ شيء ناقص، ويمكنك إعادة المحاولة.
          {error.digest && (
            <>
              {' '}رقم الحادثة <code dir="ltr" className="text-muted/70">{error.digest}</code>
            </>
          )}
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <button className="btn-primary" onClick={reset}>إعادة المحاولة</button>
          <Link href="/app/dashboard" className="btn-ghost">إلى اللوحة</Link>
        </div>
      </div>
    </main>
  );
}
