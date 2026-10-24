'use client';

import type { AuditEvent } from '@chordflow/chart-schema';
import { useEffect, useState } from 'react';
import { getJson } from '@/lib/api/client';

const ACTION_LABEL: Readonly<Record<AuditEvent['action'], string>> = {
  created: '建立',
  settings_changed: '變更可見度／權利',
  revision_published: '發布修訂',
};
const VISIBILITY_LABEL: Readonly<Record<string, string>> = {
  private: '私人',
  shared: '會員可見',
  public: '公開',
};
const RIGHTS_LABEL: Readonly<Record<string, string>> = {
  unknown: '不明',
  synthetic: '合成',
  owner_original: '原創',
  licensed: '已授權',
  permission_granted: '權利人同意',
  public_domain: '公有領域',
  not_permitted: '不允許',
};
const ASSETS = [
  ['lyrics', '歌詞'],
  ['chart', '和弦譜'],
  ['audio', '音訊'],
] as const;

/** Human-readable differences between two snapshots (or the initial values). */
function changes(event: AuditEvent): string[] {
  const { before, after } = event;
  const out: string[] = [];
  if (before?.visibility !== after.visibility) {
    out.push(
      `可見度：${before ? `${VISIBILITY_LABEL[before.visibility] ?? before.visibility} → ` : ''}${VISIBILITY_LABEL[after.visibility] ?? after.visibility}`,
    );
  }
  for (const [key, label] of ASSETS) {
    const from = before?.rights[key];
    const to = after.rights[key];
    if (from !== to) {
      out.push(
        `${label}權利：${from === undefined ? '' : `${RIGHTS_LABEL[from] ?? from} → `}${RIGHTS_LABEL[to] ?? to}`,
      );
    }
  }
  if ((before?.rights.attribution ?? null) !== after.rights.attribution) {
    out.push(`署名：${after.rights.attribution ?? '（無）'}`);
  }
  if (event.action === 'revision_published') {
    out.push(`發布第 ${event.details.revision ?? '?'} 版修訂`);
  }
  if (event.details.via === 'generation_job') out.push('由生成任務建立');
  return out;
}

export function AuditLog({ arrangementId }: { arrangementId: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getJson<{ events: AuditEvent[] }>(`/api/v1/arrangements/${arrangementId}/audit`).then(
      (result) => {
        if (result.data === null) setMessage(result.error?.message ?? '無法載入紀錄');
        else setEvents(result.data.events);
      },
    );
  }, [arrangementId]);

  if (events === null) return <p role="status">{message ?? '載入中…'}</p>;
  if (events.length === 0) return <p>沒有紀錄（在稽核紀錄功能之前建立的編曲）。</p>;
  return (
    <ol aria-label="權利紀錄" className="space-y-3" data-testid="audit-log">
      {events.map((event) => (
        <li key={event.id} className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">
            {ACTION_LABEL[event.action]}・{new Date(event.at).toLocaleString('zh-TW')}・
            {event.actor?.name ?? '系統'}
          </p>
          <ul className="mt-1 list-disc ps-5">
            {changes(event).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
