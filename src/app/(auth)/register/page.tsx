import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/client/forms';
import { currentSession } from '@/server/http/context';

export const metadata = { title: 'إنشاء مساحة عمل — رَصْد' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await currentSession()) redirect('/app/dashboard');
  return (
    <div>
      <h1 className="text-2xl">إنشاء مساحة عمل</h1>
      <p className="mt-3 text-sm text-muted">
        تُنشأ مساحة عمل مستقلة لمنشأتك، وتكون أنت مالكها. بيانات كل منشأة معزولة تماماً.
      </p>
      <div className="mt-7">
        <RegisterForm />
      </div>
      <p className="mt-7 text-xs text-muted">
        لديك حساب؟{' '}
        <Link href="/login" className="text-blue-soft hover:text-ink">تسجيل الدخول</Link>
      </p>
    </div>
  );
}
