// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/**
 * One flat config for both the API and the console.
 *
 * Formatting rules are left entirely to Prettier (via eslint-config-prettier),
 * so ESLint only ever reports things that change behaviour.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'web/dist/**',
      'node_modules/**',
      'web/node_modules/**',
      'web/src/components/ui/**', // vendored shadcn source; upstream's style, not ours
      'docs/openapi.json',
      'coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── API and scripts ──────────────────────────────────────────────────────
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Structured logging is the rule; the one legitimate exception carries a
      // disable comment explaining why.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-implicit-coercion': 'error',
      'prefer-const': 'error',
    },
  },

  // Test and tooling files run in Node and legitimately print. The browser
  // globals are for page.evaluate() bodies, which execute in the page.
  {
    files: ['tests/**/*.{ts,mjs}', 'scripts/**/*.{ts,mjs}', 'web/tests/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // k6 scripts run in k6's own runtime, not Node: __ENV and console are
  // provided by the host, and the k6/* imports resolve inside it.
  {
    files: ['tests/load/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', console: 'readonly' },
    },
  },

  // ── Console ──────────────────────────────────────────────────────────────
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  {
    files: ['web/**/*.{ts,tsx}', 'web/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier
);
