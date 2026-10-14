import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/http-e2e',
  outputDir: './test-results/http',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://localhost:5175', headless: true, screenshot: 'only-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host localhost --port 5175 --strictPort',
    env: { VITE_AUTH_MODE: 'http' },
    url: 'http://localhost:5175',
    reuseExistingServer: false,
  },
});
