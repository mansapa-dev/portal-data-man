const js = require('@eslint/js');
const ts = require('typescript-eslint');

module.exports = ts.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'eslint.config.js',
      'prettier.config.js',
      '**/*.config.cjs',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
