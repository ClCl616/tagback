import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pkg from './package.json';

function kioskArtifact(): Plugin {
  return {
    name: 'tagback-kiosk-artifact',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        // Catch accidental imports of account flows or routes before an installed app is shipped.
        const forbidden =
          /\/src\/(?:admin\/|mobile\/|main\.tsx$|shared\/(?:api|auth|httpAuth|catalogHttp)\.ts$)/;
        for (const id of this.getModuleIds()) {
          if (forbidden.test(id.replaceAll('\\', '/')))
            this.error(`Non-kiosk module in installed build: ${id}`);
        }
        const files = Object.values(bundle)
          .map((output) => {
            const content = output.type === 'chunk' ? output.code : output.source;
            return {
              path: output.fileName,
              sha256: createHash('sha256').update(content).digest('hex'),
            };
          })
          .sort((a, b) => a.path.localeCompare(b.path));
        const uiBuildHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
        this.emitFile({
          type: 'asset',
          fileName: 'kiosk-build.json',
          source: JSON.stringify(
            {
              artifact: 'tagback-kiosk-ui',
              appVersion: pkg.version,
              hostProtocolVersion: 2,
              transportVersion: 1,
              entry: 'kiosk-app.html',
              uiBuildHash,
              files,
            },
            null,
            2,
          ),
        });
      },
    },
  };
}
export default defineConfig({
  plugins: [react(), kioskArtifact()],
  base: './',
  build: {
    outDir: 'dist-kiosk',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./kiosk-app.html', import.meta.url)) },
  },
});
