'use client';

import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { useAccount } from './account-context';

export function LoginForm() {
  const account = useAccount();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (account.status === 'loading') return <p className="text-ink-muted">讀取中…</p>;
  if (!account.accountsEnabled)
    return <p role="note">示範模式沒有帳號功能；所有示範譜都可以直接開啟。</p>;
  if (account.user !== null) return <p>你已登入為 {account.user.name}。</p>;

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    fetch('/api/auth/sign-in/email', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    })
      .then(async (response) => {
        if (response.ok) {
          await account.refresh();
          router.push('/');
          return;
        }
        setError(response.status === 429 ? '嘗試次數太多，請稍後再試。' : 'Email 或密碼不正確。');
        setBusy(false);
      })
      .catch(() => {
        setError('無法連線，請稍後再試。');
        setBusy(false);
      });
  };

  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      <label className="block space-y-1 text-sm">
        <span>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>密碼</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
        />
      </label>
      {error !== null && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-md bg-ink px-5 font-medium text-surface disabled:opacity-50"
      >
        登入
      </button>
      <p className="text-xs text-ink-muted">chordflow 採邀請制，沒有公開註冊。</p>
    </form>
  );
}
