import { existsSync } from 'node:fs';
import { buildOpenApi } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

describe('OpenAPI paths have route handlers', () => {
  const paths = buildOpenApi().paths as Record<string, Partial<Record<string, unknown>>>;

  it.each(Object.keys(paths))('%s', async (path) => {
    const dir = path.replace(
      /\{(\w+)\}/g,
      (_m, name: string) => `[${name === 'rev' ? 'rev' : 'id'}]`,
    );
    const file = new URL(`.${dir}/route.ts`, import.meta.url);
    expect(existsSync(file), `missing ${file.pathname}`).toBe(true);
    const source = (await import(/* @vite-ignore */ file.href)) as Record<string, unknown>;
    for (const method of METHODS) {
      if (paths[path]?.[method] !== undefined) {
        expect(typeof source[method.toUpperCase()], `${method.toUpperCase()} ${path}`).toBe(
          'function',
        );
      }
    }
  });
});
