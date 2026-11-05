import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',testMatch:'room-game.spec.js',outputDir:'./test-results/room-game',
  workers:1,timeout:20000,
  use:{channel:process.platform==='win32'?'msedge':undefined,viewport:{width:1440,height:1000}},
});
