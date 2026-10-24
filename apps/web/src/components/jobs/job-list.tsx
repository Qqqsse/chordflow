'use client';

import type { GenerationJobView } from '@chordflow/chart-schema';
import { useCallback, useEffect, useState } from 'react';
import { getJson, postJson } from './http';
import { JOB_ERROR_LABEL, JOB_STATUS_LABEL, LIVE_STATUSES, STAGE_LABEL } from './labels';

const POLL_MS = 1500;

export function JobStatusText({ job }: { job: GenerationJobView }) {
  return (
    <span data-testid="job-status" data-status={job.status}>
      {JOB_STATUS_LABEL[job.status]}
      {job.status === 'processing' && job.progress !== null && (
        <>
          ：{STAGE_LABEL[job.progress.stage]}（{Math.round(job.progress.fraction * 100)}%）
        </>
      )}
    </span>
  );
}

/** Recent jobs with live status; polls only while some job can still change. */
export function JobList({ refreshKey }: { refreshKey: number }) {
  const [jobs, setJobs] = useState<GenerationJobView[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getJson<{ items: GenerationJobView[] }>('/api/v1/generation-jobs').then((result) => {
        if (result.data === null) setMessage(result.error?.message ?? '無法載入任務');
        else setJobs(result.data.items);
      }),
    [],
  );

  const live = jobs?.some((job) => LIVE_STATUSES.has(job.status)) ?? true;

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [live, load]);

  const cancel = async (id: string) => {
    const result = await postJson(`/api/v1/generation-jobs/${id}/cancel`, {});
    if (result.error !== null) setMessage(result.error.message);
    await load();
  };

  if (jobs === null) return <p role="status">{message ?? '載入中…'}</p>;
  if (jobs.length === 0) return <p>還沒有任務。</p>;
  return (
    <div className="space-y-2">
      {message !== null && <p role="alert">{message}</p>}
      <ul aria-label="生成任務" className="divide-y divide-border rounded-lg border border-border">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm"
            data-job-id={job.id}
          >
            <span className="font-medium">{job.title}</span>
            <JobStatusText job={job} />
            <span className="text-ink-muted">
              第 {job.attempt}／{job.maxAttempts} 次
            </span>
            {job.error !== null && (
              <span className="text-ink-muted" data-testid="job-error">
                {job.status === 'failed' ? '' : '上次：'}
                {JOB_ERROR_LABEL[job.error.code]}
              </span>
            )}
            <span className="ms-auto flex gap-2">
              {job.draft !== null && (
                <a className="underline" href={`/admin/jobs/${job.id}`}>
                  {job.status === 'needs_review' ? '審查草稿' : '查看結果'}
                </a>
              )}
              {LIVE_STATUSES.has(job.status) && (
                <button
                  type="button"
                  onClick={() => void cancel(job.id)}
                  className="min-h-11 rounded-md border border-border px-3"
                >
                  取消
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
