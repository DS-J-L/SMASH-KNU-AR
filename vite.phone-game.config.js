import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./frontend/phone-game/',import.meta.url)),
  base:'/monitor/phone-game/',publicDir:false,
  build:{outDir:fileURLToPath(new URL('./web/monitor/phone-game/',import.meta.url)),
    emptyOutDir:true,chunkSizeWarningLimit:2600,rollupOptions:{external:id=>id.startsWith('/shared/')}},
});
