import { describe, expect, it } from 'vitest';
import { ConfigError, readRuntimeConfig } from './config';

describe('readRuntimeConfig', () => {
  it('defaults to demo mode without a database', () => {
    expect(readRuntimeConfig({})).toEqual({ dataMode: 'demo', hasDatabaseUrl: false });
  });

  it('accepts database mode when DATABASE_URL is present', () => {
    expect(
      readRuntimeConfig({ CHORDFLOW_DATA_MODE: 'database', DATABASE_URL: 'postgres://x' }),
    ).toEqual({ dataMode: 'database', hasDatabaseUrl: true });
  });

  it('rejects database mode without DATABASE_URL', () => {
    expect(() => readRuntimeConfig({ CHORDFLOW_DATA_MODE: 'database' })).toThrow(ConfigError);
  });

  it('rejects unknown modes instead of silently falling back', () => {
    expect(() => readRuntimeConfig({ CHORDFLOW_DATA_MODE: 'mock' })).toThrow(ConfigError);
  });
});
