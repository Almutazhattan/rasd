import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/client/forms';
import { currentSession } from '@/server/http/context';

export const metadata = { title: 'تسجيل الدخول — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentSession()) redirect('/app/dashboard');
  return (
    <div>
      <h1 className="text-2xl">تسجيل الدخول</h1>
      <p className="mt-3 text-sm text-muted">ادخل إلى مساحة عمل منشأتك.</p>
      <div className="mt-7">
        <LoginForm />
      </div>
      <div className="mt-7 flex items-center justify-between text-xs text-muted">
        <Link href="/forgot-password" className="hover:text-ink">نسيت كلمة المرور؟</Link>
        <Link href="/register" className="hover:text-ink">إنشاء مساحة عمل</Link>
      </div>
    </div>
  );
}
