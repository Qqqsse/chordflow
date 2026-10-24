import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'music-theory',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
