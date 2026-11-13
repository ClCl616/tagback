import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/live-e2e',
  testMatch: ['admin.spec.ts', 'return.spec.ts', 'windows-journey.spec.ts'],
  outputDir: './test-results/full-journey',
  timeout: 120000,
  workers: 1,
  use: { baseURL: process.env.TAGBACK_LIVE_BASE_URL, ignoreHTTPSErrors: true, headless: true },
  reporter: 'list',
});
