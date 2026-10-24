import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Database } from '../db/client';
import { authAccounts, authSessions, authUsers, authVerifications } from '../db/auth-schema';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password';

/*
 * Authentication (SPEC §12) via better-auth: email + password with Argon2id,
 * database sessions in HTTP-only SameSite=Lax cookies (Secure on https),
 * Origin checks for state-changing requests, built-in rate limiting.
 * Public sign-up is disabled: accounts come from the bootstrap CLI or an
 * invitation (see invitations.ts).
 */

export interface AuthConfig {
  baseURL: string;
  secret: string;
}

export function readAuthConfig(env: Readonly<Record<string, string | undefined>>): AuthConfig {
  const baseURL = env.APP_BASE_URL ?? '';
  const secret = env.BETTER_AUTH_SECRET ?? '';
  if (!/^https?:\/\//.test(baseURL)) throw new Error('APP_BASE_URL must be an http(s) URL');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  return { baseURL, secret };
}

export function createAuth(db: Database, config: AuthConfig) {
  return betterAuth({
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [new URL(config.baseURL).origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'member', input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      storage: 'memory',
      // Brute-force guard for password sign-in: 10 attempts per minute per client.
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
    },
    advanced: {
      useSecureCookies: config.baseURL.startsWith('https://'),
      cookiePrefix: 'chordflow',
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
