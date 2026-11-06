import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/live-e2e',
  testMatch: 'return.spec.ts',
  outputDir: './test-results/kiosk-live',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.TAGBACK_LIVE_BASE_URL || 'http://127.0.0.1:5182',
    ignoreHTTPSErrors: true,
    headless: true,
  },
  reporter: 'list',
});
