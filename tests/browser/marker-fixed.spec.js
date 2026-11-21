import {test,expect} from '@playwright/test';
import * as g from '../../web/test/mono3d/geometry.js';

// Real phone page flow. The marker is used once, at calibration. Afterwards the camera pose stays exactly
// as calibrated, whether the marker moves in the video or disappears altogether.
const W=720,H=1280,SIDE=.6,C=[.1,-2.2,1.1];
const f=g.normalize(g.sub([0,0,.8],C)),r=g.normalize(g.cross(f,[0,0,1])),d=g.cross(f,r),R=[...r,...d,...f];
const pose={R,t:g.scale(g.matVec(R,C),-1),C},K=g.intrinsicsFromFov(W,H,80);
const homographyFor=C2=>{
  const f2=g.normalize(g.sub([0,0,.8],C2)),r2=g.normalize(g.cross(f2,[0,0,1])),d2=g.cross(f2,r2),R2=[...r2,...d2,...f2];
  const pose2={R:R2,t:g.scale(g.matVec(R2,C2),-1),C:C2};
  const quad=[[-1,1],[1,1],[1,-1],[-1,-1]].map(([x,y])=>g.project(K,pose2,[x*SIDE/2,y*SIDE/2,0]));
  return g.homography([[0,0],[6,0],[6,6],[0,6]],quad);
};
const h=homographyFor(C),moved=[.7,-2.0,1.1],h2=homographyFor(moved);
const joints={0:[0,0,1.6],11:[-.18,0,1.45],12:[.18,0,1.45],13:[-.28,0,1.2],14:[.28,0,1.2],15:[-.3,0,1.1],16:[.3,0,1.1],
  23:[-.1,0,.95],24:[.1,0,.95],25:[-.1,0,.5],26:[.1,0,.5],27:[-.1,0,.09],28:[.1,0,.09]};
const landmarks=[],world=[];
for(let i=0;i<33;i++){
  if(!joints[i]){landmarks.push({x:0,y:0,visibility:0});world.push({x:0,y:0,z:0});continue;}
  const [u,v]=g.project(K,pose,joints[i]),w=g.scale(g.matVec(R,g.sub(joints[i],[0,0,.95])),.9);
  landmarks.push({x:u/W,y:v/H,visibility:.95});world.push({x:w[0],y:w[1],z:w[2]});
}

test('mono3d phone: camera pose stays as calibrated when the marker moves or disappears',async({page,context})=>{
  test.setTimeout(120000);const errors=[],calibs=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',ws=>ws.on('framesent',e=>{try{const m=JSON.parse(e.payload);if(m.type==='mono3d_calib'&&m.camera)calibs.push(m.camera.C);}catch{/* binary */}}));
  await context.addInitScript(h=>{
    window.markerH=h;
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;const ctx=canvas.getContext('2d');
      const bits=[[1,0,1,1],[0,1,0,1],[0,0,1,1],[0,0,1,0]];
      const p=(x,y)=>{const h=window.markerH,w=h[6]*x+h[7]*y+1;return [(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];};
      const fill=(x,y,size,color)=>{ctx.fillStyle=color;ctx.beginPath();[[x,y],[x+size,y],[x+size,y+size],[x,y+size]].forEach(([u,v],i)=>i?ctx.lineTo(...p(u,v)):ctx.moveTo(...p(u,v)));ctx.closePath();ctx.fill();};
      let n=0;const draw=()=>{ctx.fillStyle='#eee';ctx.fillRect(0,0,720,1280);if(!window.hideMarker){fill(0,0,6,'#000');for(let r=0;r<4;r++)for(let c=0;c<4;c++)if(bits[r][c])fill(c+1,r+1,1,'#fff');}ctx.fillStyle=n++%2?'#fff':'#eee';ctx.fillRect(0,0,4,4);};
      draw();setInterval(draw,50);return canvas.captureStream(20);
    };
  },h);
  const stub=`export async function createPoseLandmarker(){const d=${JSON.stringify({landmarks,world})};
    return {delegate:'CPU',landmarker:{detectForVideo(){return {landmarks:[d.landmarks],worldLandmarks:[d.world],close(){}};},close(){}}};}`;
  await page.route('**/camera/pose.js*',route=>route.fulfill({contentType:'application/javascript',body:stub}));
  await page.goto('/test/mono3d/?key=fragment-test');await page.locator('#start').click();
  await page.locator('#markerCm').fill(String(SIDE*100));await page.locator('#markerCm').dispatchEvent('change');
  await page.locator('#cameraHeight').fill(String(C[2]));await page.locator('#cameraHeight').dispatchEvent('change');
  await page.locator('#autoMarker').click();await expect(page.locator('#cornerDone')).toBeVisible({timeout:20000});
  await page.locator('#toBody').click();await page.locator('#calibBody').click();
  await expect(page.locator('#toMeasure')).toBeVisible({timeout:30000});await page.locator('#toMeasure').click();
  await expect.poll(()=>calibs.length,{timeout:15000}).toBeGreaterThan(0);
  const first=calibs.at(-1),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  expect(dist(first,C)).toBeLessThan(.2);
  await page.waitForTimeout(800);const count=calibs.length;
  await page.evaluate(h=>{window.markerH=h;},h2);await page.waitForTimeout(2000);   // the marker appears elsewhere
  await page.evaluate(()=>{window.hideMarker=true;});await page.waitForTimeout(2000);  // and then is gone
  expect(calibs.length).toBe(count);expect(calibs.at(-1)).toEqual(first);
  await expect(page.locator('#trackMarker')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('multi3d phone: camera pose sent to the server stays as calibrated when the marker moves or disappears',async({page,context})=>{
  test.setTimeout(90000);const errors=[],calibs=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',ws=>ws.on('framesent',e=>{try{const m=JSON.parse(e.payload);if(m.type==='multi3d_calib'&&m.C)calibs.push(m.C);}catch{/* binary */}}));
  await context.addInitScript(h=>{
    window.markerH=h;
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;const ctx=canvas.getContext('2d');
      const bits=[[1,0,1,1],[0,1,0,1],[0,0,1,1],[0,0,1,0]];
      const p=(x,y)=>{const h=window.markerH,w=h[6]*x+h[7]*y+1;return [(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];};
      const fill=(x,y,size,color)=>{ctx.fillStyle=color;ctx.beginPath();[[x,y],[x+size,y],[x+size,y+size],[x,y+size]].forEach(([u,v],i)=>i?ctx.lineTo(...p(u,v)):ctx.moveTo(...p(u,v)));ctx.closePath();ctx.fill();};
      let n=0;const draw=()=>{ctx.fillStyle='#eee';ctx.fillRect(0,0,720,1280);if(!window.hideMarker){fill(0,0,6,'#000');for(let r=0;r<4;r++)for(let c=0;c<4;c++)if(bits[r][c])fill(c+1,r+1,1,'#fff');}ctx.fillStyle=n++%2?'#fff':'#eee';ctx.fillRect(0,0,4,4);};
      draw();setInterval(draw,50);return canvas.captureStream(20);
    };
  },h);
  await page.route('**/camera/pose.js*',route=>route.fulfill({contentType:'application/javascript',body:"export async function createPoseLandmarker(){return {delegate:'CPU',landmarker:{detectForVideo(){return {landmarks:[],worldLandmarks:[]};},close(){}}};}"}));
  await page.goto('/test/multi3d/?key=fragment-test');await page.locator('#start').click();
  await page.locator('#markerCm').fill(String(SIDE*100));await page.locator('#markerCm').dispatchEvent('change');
  await page.locator('#cameraHeight').fill(String(C[2]));await page.locator('#cameraHeight').dispatchEvent('change');
  await page.locator('#autoMarker').click();await expect(page.locator('#cornerDone')).toBeVisible({timeout:20000});
  await page.locator('#toSend').click();
  await expect.poll(()=>calibs.length,{timeout:15000}).toBeGreaterThan(0);
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const first=calibs.at(-1);expect(dist(first,C)).toBeLessThan(.2);
  await page.waitForTimeout(800);const count=calibs.length;
  await page.evaluate(h=>{window.markerH=h;},h2);await page.waitForTimeout(2000);
  await page.evaluate(()=>{window.hideMarker=true;});await page.waitForTimeout(2000);
  expect(calibs.length).toBe(count);expect(calibs.at(-1)).toEqual(first);
  await expect(page.locator('#trackMarker')).toHaveCount(0);
  expect(errors).toEqual([]);
});
