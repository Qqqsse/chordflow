import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'chordpro',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
