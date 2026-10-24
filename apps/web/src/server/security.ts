import 'server-only';
import { ApiProblem } from '@/lib/api/handler';

/**
 * CSRF defence for cookie-authenticated, state-changing API routes: the
 * Origin header must match APP_BASE_URL (SameSite=Lax cookies are the second
 * layer). Requests without an Origin header are rejected.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.APP_BASE_URL ?? 'http://localhost').origin;
  if (origin !== expected)
    throw new ApiProblem(403, 'CSRF_REJECTED', 'Cross-origin request rejected');
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window, per-process rate limit. Client IPs come from
 * X-Forwarded-For only when TRUST_PROXY=true (behind a trusted reverse proxy).
 */
export function rateLimit(request: Request, scope: string, limit: number, windowMs: number): void {
  const forwarded =
    process.env.TRUST_PROXY === 'true' ? request.headers.get('x-forwarded-for') : null;
  const ip = forwarded?.split(',')[0]?.trim() ?? 'direct';
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (bucket === undefined || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new ApiProblem(429, 'RATE_LIMITED', 'Too many requests; try again later', {
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    });
  }
}

export function resetRateLimits(): void {
  buckets.clear();
}
