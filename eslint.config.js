import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2023
      }
    },
    rules: {
      'no-console': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'always', { null: 'ignore' }]
    }
  },
  {
    // Config files use ESM (import/export)
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    }
  },
  {
    // Test files: looser rules, ESM syntax
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.vitest
      }
    },
    rules: {
      'no-console': 'off',
      'no-unused-expressions': 'off'
    }
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '.github/**',
      'src/services/promptLoader.js'
    ]
  }
];
