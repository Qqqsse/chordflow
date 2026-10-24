import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi';

describe('openapi/openapi.v1.json', () => {
  it('is up to date (run `pnpm --filter @chordflow/chart-schema generate:json-schema`)', () => {
    const committed = readFileSync(new URL('../openapi/openapi.v1.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(buildOpenApi(), null, 2)}\n`);
  });

  it('references only defined components', () => {
    const doc = buildOpenApi();
    const text = JSON.stringify(doc.paths);
    const schemas = Object.keys((doc.components as { schemas: Record<string, unknown> }).schemas);
    for (const [, name] of text.matchAll(/#\/components\/schemas\/(\w+)/g)) {
      expect(schemas).toContain(name);
    }
  });
});
