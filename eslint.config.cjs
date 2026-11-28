const { createRequire } = require('node:module');

// npm exec installs the pinned lint tools together, outside the application dependency tree.
const toolRequire = createRequire(process.argv[1]);
const js = toolRequire('@eslint/js');
const parser = toolRequire('@typescript-eslint/parser');
const typescript = toolRequire('@typescript-eslint/eslint-plugin');
const hooks = toolRequire('eslint-plugin-react-hooks');

module.exports = [
  { ignores: ['dist/**', 'dist-electron/**', 'dist-tests/**', 'release/**', 'coverage/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': typescript },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      'no-undef': 'off', // TypeScript checks names, including ambient declarations.
      'no-control-regex': 'off', // Control-character validation is intentional.
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-require-imports': 'off' // Native modules and CommonJS test adapters.
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      curly: ['error', 'all'],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { overrides: { constructors: 'no-public', parameterProperties: 'off' } }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
];
