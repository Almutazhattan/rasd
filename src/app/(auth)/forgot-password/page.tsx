import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/client/forms';

export const metadata = { title: 'إعادة تعيين كلمة المرور — رَصْد' };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl">إعادة تعيين كلمة المرور</h1>
      <p className="mt-3 text-sm text-muted">
        أدخل بريدك وسنرسل رابط إعادة التعيين إن كان له حساب. لا نكشف ما إذا كان البريد مسجّلاً.
      </p>
      <div className="mt-7">
        <ForgotPasswordForm />
      </div>
      <p className="mt-7 text-xs text-muted">
        <Link href="/login" className="hover:text-ink">العودة إلى تسجيل الدخول</Link>
      </p>
    </div>
  );
}
