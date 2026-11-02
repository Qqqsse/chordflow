'use client';

import { useAccount } from './account-context';

export function AccountMenu() {
  const account = useAccount();
  if (account.status === 'loading' || !account.accountsEnabled) return null;
  if (account.user === null) {
    return (
      <a href="/login" className="ml-auto text-ink-muted hover:text-ink">
        登入
      </a>
    );
  }
  return (
    <span className="ml-auto flex items-center gap-3">
      <a href="/library" className="text-ink-muted hover:text-ink">
        我的譜庫
      </a>
      <a href="/uploads" className="text-ink-muted hover:text-ink">
        我的音訊
      </a>
      {account.user.role === 'admin' && (
        <a href="/admin" className="text-ink-muted hover:text-ink">
          管理
        </a>
      )}
      <span className="text-ink-muted" data-testid="account-name">
        {account.user.name}
      </span>
      <button
        type="button"
        className="text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        onClick={() => {
          void account.signOut();
        }}
      >
        登出
      </button>
    </span>
  );
}
