'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useAccount } from './account-context';

const MESSAGES: Readonly<Record<string, string>> = {
  INVITATION_INVALID: '這個邀請無效、已過期或已被使用。',
  EMAIL_TAKEN: '這個 Email 已經有帳號了。',
  INVALID_INPUT: '請確認姓名、Email，以及至少 12 個字元的密碼。',
};

/** Token travels in the URL fragment, so it never reaches server logs. */
function readToken(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

export function InviteForm() {
  const account = useAccount();
  const router = useRouter();
  const token = useSyncExternalStore(
    (onChange) => {
      window.addEventListener('hashchange', onChange);
      return () => {
        window.removeEventListener('hashchange', onChange);
      };
    },
    readToken,
    () => '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (token === '') return <p role="alert">邀請連結不完整，請向管理員索取新的連結。</p>;

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    fetch('/api/v1/invitations/accept', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
      }),
    })
      .then(async (response) => {
        if (response.ok) {
          await account.refresh();
          router.push('/');
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          error?: { details?: { reason?: string } | null; code?: string };
        } | null;
        const reason = body?.error?.details?.reason ?? body?.error?.code ?? '';
        setError(
          MESSAGES[reason] ??
            (response.status === 429 ? '嘗試次數太多，請稍後再試。' : '無法建立帳號。'),
        );
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
        <span>顯示名稱</span>
        <input
          name="name"
          required
          maxLength={80}
          autoComplete="name"
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>密碼（至少 12 個字元）</span>
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
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
        建立帳號
      </button>
    </form>
  );
}
