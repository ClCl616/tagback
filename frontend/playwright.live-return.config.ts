import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/live-e2e',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5182', headless: true },
  reporter: 'list',
});
