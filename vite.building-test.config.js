import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./frontend/building-test/', import.meta.url)),
  base: '/test/building/', publicDir: false,
  build: { outDir: fileURLToPath(new URL('./web/test/building/', import.meta.url)), emptyOutDir: true,
    rollupOptions: { external: id => id.startsWith('/test/') || id.startsWith('/shared/') } },
});
