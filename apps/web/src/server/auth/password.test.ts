import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses Argon2id with the configured cost and verifies', async () => {
    const hashed = await hashPassword('correct horse battery staple');
    expect(hashed.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword({ hash: hashed, password: 'correct horse battery staple' })).toBe(
      true,
    );
    expect(await verifyPassword({ hash: hashed, password: 'wrong' })).toBe(false);
  });

  it('salts every hash and rejects malformed hashes without throwing', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
    expect(await verifyPassword({ hash: 'not-a-hash', password: 'x' })).toBe(false);
  });
});
