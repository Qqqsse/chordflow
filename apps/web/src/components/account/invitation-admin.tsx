'use client';

import { useCallback, useEffect, useState } from 'react';

interface InvitationRow {
  id: string;
  role: string;
  note: string | null;
  expiresAt: string;
  usedAt: string | null;
}

export function InvitationAdmin() {
  const [rows, setRows] = useState<InvitationRow[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/v1/invitations', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setRows(((await r.json()) as { data: InvitationRow[] }).data);
      })
      .catch(() => {
        setError('無法讀取邀請列表（需要管理員身分）。');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = (role: 'member' | 'admin') => {
    setLink(null);
    fetch('/api/v1/invitations', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setLink(((await r.json()) as { data: { acceptUrl: string } }).data.acceptUrl);
        load();
      })
      .catch(() => {
        setError('無法建立邀請。');
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-surface"
          onClick={() => {
            create('member');
          }}
        >
          建立會員邀請
        </button>
        <button
          type="button"
          className="min-h-11 rounded-md border border-border px-4 text-sm"
          onClick={() => {
            create('admin');
          }}
        >
          建立管理員邀請
        </button>
      </div>
      {link !== null && (
        <div role="status" className="space-y-1 rounded-md border border-border p-3 text-sm">
          <p>邀請連結（只會顯示這一次，7 天內有效、只能使用一次）：</p>
          <code className="block break-all" data-testid="invite-link">
            {link}
          </code>
        </div>
      )}
      {error !== null && <p role="alert">{error}</p>}
      {rows !== null && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>身分</th>
              <th>到期</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.role === 'admin' ? '管理員' : '會員'}</td>
                <td>{new Date(r.expiresAt).toLocaleDateString('zh-TW')}</td>
                <td>
                  {r.usedAt !== null
                    ? '已使用'
                    : new Date(r.expiresAt) < new Date()
                      ? '已過期'
                      : '可使用'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
