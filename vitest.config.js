import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      OPENAI_API_KEY: 'test-key-for-testing',
      RESEND_API_KEY: 'test-key-for-testing',
      EMAIL_USER: 'test@example.com',
      EMAIL_PASS: 'test-password'
    }
  }
});
