import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./frontend/fracture/', import.meta.url)),
  base: '/monitor/fracture/',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./web/monitor/fracture/', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2600,
  },
});
