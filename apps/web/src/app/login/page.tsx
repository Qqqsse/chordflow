import type { Metadata } from 'next';
import { LoginForm } from '@/components/account/login-form';

export const metadata: Metadata = { title: '登入' };

export default function LoginPage() {
  return (
    <section aria-labelledby="login-title" className="space-y-4">
      <h1 id="login-title" className="text-2xl font-bold">
        登入
      </h1>
      <LoginForm />
    </section>
  );
}
