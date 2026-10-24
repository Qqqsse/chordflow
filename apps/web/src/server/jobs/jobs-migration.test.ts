import { readFileSync } from 'node:fs';
import { JOB_STATES, allowedTransitions } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import { retryBackoffSeconds } from './worker-service';

const migration = readFileSync(
  new URL('../../../drizzle/0003_generation_jobs.sql', import.meta.url),
  'utf8',
);

describe('generation job migration', () => {
  it('the database transition guard matches the TypeScript state machine exactly', () => {
    const block = /NOT IN \(VALUES([\s\S]*?)\) THEN/.exec(migration)?.[1] ?? '';
    const inSql = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map(
      (m) => `${m[1]}>${m[2]}`,
    );
    const inTs = JOB_STATES.flatMap((from) =>
      allowedTransitions(from).map((to) => `${from}>${to}`),
    );
    expect(inSql.sort()).toEqual(inTs.sort());
  });

  it('retry backoff doubles per attempt and is capped', () => {
    expect([1, 2, 3, 4].map((a) => retryBackoffSeconds(a, 10))).toEqual([10, 20, 40, 80]);
    expect(retryBackoffSeconds(20, 10)).toBe(600);
    expect(retryBackoffSeconds(1, 0)).toBe(0);
  });
});
