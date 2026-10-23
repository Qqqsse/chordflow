import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      '@': path.join(dirname, 'src'),
      // `server-only` throws outside the React server condition; tests run server code directly.
      'server-only': path.join(dirname, 'src/testing/server-only-stub.ts'),
    },
  },
  test: {
    name: 'web',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
