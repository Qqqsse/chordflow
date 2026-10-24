import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default; asserted by tests via the `$argon2id$` prefix)
 * with OWASP-recommended parameters: 19 MiB, t=2, p=1.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(data.hash, data.password);
  } catch {
    return false;
  }
}
