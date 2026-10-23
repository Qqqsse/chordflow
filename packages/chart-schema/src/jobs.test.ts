import { describe, expect, it } from 'vitest';
import {
  InvalidJobTransitionError,
  JOB_STATES,
  allowedTransitions,
  assertTransition,
  canTransition,
  isTerminalJobState,
  toExternalJobStatus,
  type JobState,
} from './jobs';

function walk(path: JobState[]): void {
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    if (from === undefined || to === undefined) throw new Error('bad path');
    assertTransition(from, to);
  }
}

describe('job state machine', () => {
  it('supports the happy path through review to publication', () => {
    expect(() => {
      walk([
        'created',
        'validated',
        'queued',
        'leased',
        'running',
        'draft_ready',
        'needs_review',
        'published',
      ]);
    }).not.toThrow();
  });

  it('never publishes without review', () => {
    expect(canTransition('draft_ready', 'published')).toBe(false);
    expect(canTransition('running', 'published')).toBe(false);
  });

  it('requeues expired leases and retries retryable failures', () => {
    expect(() => {
      walk(['queued', 'leased', 'queued', 'leased', 'running', 'failed_retryable', 'queued']);
    }).not.toThrow();
  });

  it('terminal states have no exits', () => {
    const terminal = JOB_STATES.filter(isTerminalJobState);
    expect(terminal).toEqual(['published', 'failed_terminal', 'cancelled']);
    for (const state of terminal) expect(allowedTransitions(state)).toEqual([]);
  });

  it('every state is reachable from created', () => {
    const seen = new Set<JobState>(['created']);
    const queue: JobState[] = ['created'];
    while (queue.length > 0) {
      const state = queue.shift();
      if (state === undefined) break;
      for (const next of allowedTransitions(state)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...JOB_STATES].sort());
  });

  it('throws a typed error for illegal transitions', () => {
    expect(() => {
      assertTransition('published', 'queued');
    }).toThrow(InvalidJobTransitionError);
  });
});

describe('external job status', () => {
  it.each<[JobState, boolean, string]>([
    ['created', true, 'queued'],
    ['queued', true, 'queued'],
    ['queued', false, 'waiting_for_worker'],
    ['failed_retryable', false, 'waiting_for_worker'],
    ['leased', true, 'processing'],
    ['running', false, 'processing'],
    ['draft_ready', true, 'needs_review'],
    ['needs_review', true, 'needs_review'],
    ['published', true, 'completed'],
    ['failed_terminal', true, 'failed'],
    ['cancelled', true, 'cancelled'],
  ])('%s (worker available: %s) → %s', (state, workerAvailable, expected) => {
    expect(toExternalJobStatus(state, { workerAvailable })).toBe(expected);
  });
});
