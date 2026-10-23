import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Test-only helpers for reading repository fixtures. Not exported from the package. */
export const FIXTURES_DIR = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));

export function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${relativePath}`, 'utf8'));
}

export function listFixtures(relativeDir: string, suffix: string): string[] {
  return readdirSync(`${FIXTURES_DIR}${relativeDir}`)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => `${relativeDir}/${name}`);
}

export interface InvalidCase {
  description: string;
  layer: 'structural' | 'semantic';
  expectedIssue: string;
  chartFixture?: string | null;
  document: unknown;
}

export function readInvalidCase(relativePath: string): InvalidCase {
  return readFixture(relativePath) as InvalidCase;
}
