import base from './playwright.config.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({...base,testMatch:['building-combo.spec.js','super-smash.spec.js','building-fragments.spec.js','building-zones.spec.js','building-occlusion.spec.js','multi3d-accuracy.spec.js','auto-marker.spec.js','mono-occlusion-fallback.spec.js','phone-ui-panels.spec.js','marker-fixed.spec.js','building-wide.spec.js','building-duo.spec.js','building-duo-rtc.spec.js'],outputDir:'./test-results/building-fragments',
  use:{...base.use,channel:'msedge',baseURL:'http://127.0.0.1:8898'},
  webServer:process.env.BUILDING_TEST_EXTERNAL==='1'?undefined:{command:'.venv\\Scripts\\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8898',
    url:'http://127.0.0.1:8898/api/health?key=fragment-test',reuseExistingServer:false,
    env:{SMASH_ACCESS_KEY:'fragment-test'}},
});
