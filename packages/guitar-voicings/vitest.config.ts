import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'guitar-voicings',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
