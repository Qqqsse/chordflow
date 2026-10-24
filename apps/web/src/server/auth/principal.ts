import 'server-only';
import { ANONYMOUS, type Principal } from '../access';

/**
 * Resolves the caller from request headers. Sessions arrive with the
 * invitation-based accounts; until then every caller is anonymous, which the
 * access rules restrict to public content with redistribution rights.
 */
export function getPrincipalFromHeaders(_headers: Headers): Promise<Principal> {
  return Promise.resolve(ANONYMOUS);
}

export function getPrincipal(request: Request): Promise<Principal> {
  return getPrincipalFromHeaders(request.headers);
}
