import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5176',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: false,
    env: { VITE_AUTH_MODE: 'mock', VITE_KIOSK_MODE: 'mock' },
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});
