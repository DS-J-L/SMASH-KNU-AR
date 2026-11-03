import base from './playwright.config.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,outputDir:'./test-results/single-camera',
  use:{...base.use,baseURL:'http://127.0.0.1:8875'},
  webServer:{command:'python -m uvicorn backend.server:app --host 127.0.0.1 --port 8875',url:'http://127.0.0.1:8875/api/health',reuseExistingServer:false},
});
