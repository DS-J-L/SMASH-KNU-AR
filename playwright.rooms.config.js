import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'rooms.spec.js', outputDir: './test-results/rooms',
  workers: 1, timeout: 45000, expect: { timeout: 15000 },
  use: { channel: process.platform === 'win32' ? 'msedge' : undefined, baseURL: 'http://127.0.0.1:8883', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', launchOptions: {args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']} },
  webServer: {
    command: '.venv\\Scripts\\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8883 --timeout-graceful-shutdown 2',
    url: 'http://127.0.0.1:8883/api/health', reuseExistingServer: false,
    env: { SMASH_ACCESS_KEY: '', SMASH_PROJECT_CONFIG: 'config/project.example.json', SMASH_CAMERAS_CONFIG: 'config/cameras.example.json' },
  },
});
