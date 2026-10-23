import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const WEB = 'apps/web';

/** Scope Next.js rules to the web app only; shared packages must stay framework-free. */
const scopedNext = nextVitals.map((config) => {
  const keys = Object.keys(config);
  if (keys.length === 1 && keys[0] === 'ignores') {
    return config;
  }
  return {
    ...config,
    files: (config.files ?? ['**/*.{js,jsx,mjs,ts,tsx}']).map((pattern) => `${WEB}/${pattern}`),
    settings: { ...config.settings, next: { rootDir: WEB } },
  };
});

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'services/**',
    ],
  },
  js.configs.recommended,
  ...scopedNext,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
