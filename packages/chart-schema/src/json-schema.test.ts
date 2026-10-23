import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildJsonSchemas, serializeJsonSchema } from './json-schema';

describe('published JSON Schemas', () => {
  it.each(Object.entries(buildJsonSchemas()))(
    'json-schema/%s is up to date (run `pnpm --filter @chordflow/chart-schema generate:json-schema`)',
    (file, schema) => {
      const committed = readFileSync(new URL(`../json-schema/${file}`, import.meta.url), 'utf8');
      expect(committed).toBe(serializeJsonSchema(schema));
    },
  );

  it('declares strict objects', () => {
    const schema = buildJsonSchemas()['chart-document.v1.schema.json'];
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});
