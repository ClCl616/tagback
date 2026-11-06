import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/live-e2e',
  testMatch: 'admin.spec.ts',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'https://localhost:5185',
    ignoreHTTPSErrors: true,
    headless: true,
    screenshot: 'only-on-failure',
  },
  outputDir: './test-results/admin-live',
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host localhost --port 5185 --strictPort',
    url: 'https://localhost:5185',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    env: { TAGBACK_API_TARGET: 'http://127.0.0.1:18085' },
  },
});
