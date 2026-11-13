import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/kiosk-host-e2e',
  outputDir: './test-results/kiosk-host',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5179', headless: true },
  webServer: {
    command: 'pnpm build:kiosk && pnpm preview:kiosk --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179/kiosk-app.html',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
