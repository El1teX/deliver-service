import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Тесты работают с отдельной базой migom_test — её пересоздают перед прогоном.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? '', ROUTING: 'line', NODE_ENV: 'test', JWT_SECRET: 'test-secret' },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
