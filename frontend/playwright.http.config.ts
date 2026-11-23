import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/http-e2e',
  outputDir: './test-results/http',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://localhost:5175', headless: true, screenshot: 'only-on-failure',
    ...(process.env.TAGBACK_PLAYWRIGHT_CHANNEL ? { channel: process.env.TAGBACK_PLAYWRIGHT_CHANNEL } : {}) },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host localhost --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
  },
});
