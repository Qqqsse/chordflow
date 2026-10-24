import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiProblem } from '@/lib/api/handler';
import { getDatabase } from '../catalog';
import type { Database } from '../db/client';

/*
 * Worker credential (SPEC §10): a dedicated bearer token, never a user
 * session. WORKER_TOKEN is current; WORKER_TOKEN_PREVIOUS is accepted during
 * rotation. Tokens are compared as SHA-256 digests in constant time and are
 * never logged or echoed.
 */

export const MIN_WORKER_TOKEN_LENGTH = 32;

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

export function configuredWorkerTokens(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return [env.WORKER_TOKEN, env.WORKER_TOKEN_PREVIOUS]
    .map((token) => token?.trim() ?? '')
    .filter(
      (token) => token.length >= MIN_WORKER_TOKEN_LENGTH && !token.startsWith('replace-with'),
    );
}

export function matchesWorkerToken(header: string | null, tokens: readonly string[]): boolean {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '');
  if (match?.[1] === undefined) return false;
  const presented = digest(match[1]);
  // Check every token so timing does not reveal which one matched.
  let ok = false;
  for (const token of tokens) ok = timingSafeEqual(presented, digest(token)) || ok;
  return ok;
}

export function requireWorker(request: Request): Database {
  const handle = getDatabase();
  if (handle === null) throw new ApiProblem(404, 'NOT_FOUND', 'Not available in demo mode');
  const tokens = configuredWorkerTokens(process.env);
  if (tokens.length === 0) {
    throw new ApiProblem(503, 'SERVICE_UNAVAILABLE', 'The worker API is not configured');
  }
  if (!matchesWorkerToken(request.headers.get('authorization'), tokens)) {
    throw new ApiProblem(401, 'UNAUTHENTICATED', 'Worker credential required');
  }
  return handle.db;
}
