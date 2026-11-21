import base from './playwright.config.js';

export default {
  ...base,
  testMatch: 'ar-hit-sound.spec.js',
  outputDir: './test-results/ar-feedback',
  use: { ...base.use, baseURL: 'http://127.0.0.1:8899' },
  webServer: { command: 'python -m http.server 8899 --bind 127.0.0.1 --directory web',
    url: 'http://127.0.0.1:8899/test/mono3d/', reuseExistingServer: false },
};
