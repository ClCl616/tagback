import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/bridge-e2e',
  outputDir: './test-results/bridge',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5177', headless: true },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5177 --strictPort',
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: false,
    env: { VITE_AUTH_MODE: 'mock', VITE_KIOSK_MODE: 'bridge' },
  },
});
