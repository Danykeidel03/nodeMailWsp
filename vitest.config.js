import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      OPENAI_API_KEY: 'test-key-for-testing',
      RESEND_API_KEY: 'test-key-for-testing',
      EMAIL_USER: 'test@example.com',
      EMAIL_PASS: 'test-password'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'classifier.js',
        'email.js',
        'shopify.js',
        'seguimiento.js',
        'logger.js',
        'metricas.js',
        'index.js',
        'src/**/*.js'
      ],
      exclude: [
        'tests/**',
        'node_modules/**',
        'verify-env.js',
        'vitest.config.js',
        'eslint.config.js'
      ]
      // No thresholds in first pass — measure before enforcing
      // Future: thresholds: { lines: 60, functions: 60, branches: 50, statements: 60 }
    }
  }
});
