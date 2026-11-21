import base from './playwright.config.js';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,
  testMatch:['phone-game.spec.js','single-camera.spec.js'],
  outputDir:'./test-results/phone-partial',
  use:{...base.use,channel:'msedge',baseURL:process.env.PHONE_PARTIAL_EXTERNAL==='1'?'http://127.0.0.1:8897':'http://127.0.0.1:8899'},
  webServer:process.env.PHONE_PARTIAL_EXTERNAL==='1'?undefined:{command:'.venv\\Scripts\\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8899 --timeout-graceful-shutdown 2',
    url:'http://127.0.0.1:8899/api/health',reuseExistingServer:false,env:{SMASH_ACCESS_KEY:''}},
});
