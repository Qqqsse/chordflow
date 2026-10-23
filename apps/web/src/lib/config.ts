/**
 * Server-side runtime configuration. Values come from the environment only;
 * nothing here is ever sent to the browser or included in API responses.
 */

export type DataMode = 'demo' | 'database';

export interface RuntimeConfig {
  dataMode: DataMode;
  hasDatabaseUrl: boolean;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function readRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const rawMode = env.CHORDFLOW_DATA_MODE?.trim() ?? '';
  const dataMode: DataMode = rawMode === '' ? 'demo' : parseDataMode(rawMode);
  const hasDatabaseUrl = (env.DATABASE_URL ?? '').trim() !== '';
  if (dataMode === 'database' && !hasDatabaseUrl) {
    throw new ConfigError('CHORDFLOW_DATA_MODE=database requires DATABASE_URL');
  }
  return { dataMode, hasDatabaseUrl };
}

function parseDataMode(value: string): DataMode {
  if (value === 'demo' || value === 'database') {
    return value;
  }
  throw new ConfigError(`Unsupported CHORDFLOW_DATA_MODE: ${JSON.stringify(value)}`);
}
