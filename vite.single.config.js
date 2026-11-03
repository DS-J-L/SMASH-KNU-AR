import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./frontend/single/',import.meta.url)),base:'/monitor/single/',publicDir:false,
  build:{outDir:fileURLToPath(new URL('./web/monitor/single/',import.meta.url)),emptyOutDir:true,chunkSizeWarningLimit:2600},
});
