import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [react()],
  server: {
    https:
      process.env.TAGBACK_HTTPS_CERT && process.env.TAGBACK_HTTPS_KEY
        ? {
            cert: readFileSync(process.env.TAGBACK_HTTPS_CERT),
            key: readFileSync(process.env.TAGBACK_HTTPS_KEY),
          }
        : undefined,
    proxy: process.env.TAGBACK_API_TARGET
      ? {
          '/api': { target: process.env.TAGBACK_API_TARGET, changeOrigin: false },
        }
      : undefined,
  },
  test: { include: ['tests/**/*.test.ts'] },
});
