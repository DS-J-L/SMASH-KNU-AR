import { defineConfig } from '@playwright/test';
const nativeGraphics=process.env.AR_TEST_RENDERER==='d3d11';
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:8765', viewport: {width:1440,height:1000}, screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-webgl',...(nativeGraphics?['--use-angle=d3d11']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'])] } },
  webServer: { command: 'python -m uvicorn backend.server:app --host 127.0.0.1 --port 8765',
    url: 'http://127.0.0.1:8765/api/health', reuseExistingServer: true },
});
