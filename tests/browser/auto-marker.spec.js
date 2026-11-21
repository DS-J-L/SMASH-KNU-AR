import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {homography} from '../../web/test/mono3d/geometry.js';
const quad=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',"import sys,json,numpy as np;sys.path.insert(0,'tests');from test_multi3d_relay import look_at;R,t=look_at([0,-.9,1],(0,0,0));points=[[-.1,.1,0],[.1,.1,0],[.1,-.1,0],[-.1,-.1,0]];q=[R@np.array(p)+t for p in points];print(json.dumps([[900*p[0]/p[2]+360,900*p[1]/p[2]+640] for p in q]))"],{encoding:'utf8'}));
const h=homography([[0,0],[6,0],[6,6],[0,6]],quad);

for(const mode of ['mono3d','multi3d'])test(`${mode}: automatic ID0 corners pass calibration and stay fixed after capture`,async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(h=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;const ctx=canvas.getContext('2d');
      const bits=[[1,0,1,1],[0,1,0,1],[0,0,1,1],[0,0,1,0]];
      const p=(x,y)=>{const w=h[6]*x+h[7]*y+1;return [(h[0]*x+h[1]*y+h[2])/w+(window.shiftMarker?50:0),(h[3]*x+h[4]*y+h[5])/w];};
      const fill=(x,y,size,color)=>{ctx.fillStyle=color;ctx.beginPath();[[x,y],[x+size,y],[x+size,y+size],[x,y+size]].forEach(([u,v],i)=>i?ctx.lineTo(...p(u,v)):ctx.moveTo(...p(u,v)));ctx.closePath();ctx.fill();};
      let n=0;const draw=()=>{ctx.fillStyle='#eee';ctx.fillRect(0,0,720,1280);fill(0,0,6,'#000');for(let r=0;r<4;r++)for(let c=0;c<4;c++)if(bits[r][c])fill(c+1,r+1,1,'#fff');ctx.fillStyle=n++%2?'#fff':'#eee';ctx.fillRect(0,0,4,4);};
      draw();setInterval(draw,50);return canvas.captureStream(20);
    };
  },h);
  await page.route('**/camera/pose.js*',route=>route.fulfill({contentType:'application/javascript',body:"export async function createPoseLandmarker(){return {delegate:'CPU',landmarker:{detectForVideo(){return {landmarks:[],worldLandmarks:[]}},close(){}}};}"}));
  await page.goto(`/test/${mode}/?key=fragment-test`);await page.locator('#start').click();
  await expect(page.locator('#autoMarker')).toBeVisible();await expect(page.locator('#tapCorners')).toBeVisible();
  // The button disappears while the search runs and comes back when it stops.
  await page.locator('#autoMarker').click();await expect(page.locator('#autoMarker')).toBeHidden();
  await expect(page.locator('#cornerDone')).toBeVisible({timeout:15000});
  expect(await page.locator('#autoMarker').evaluate(b=>b.hidden)).toBe(false);
  await expect(page.locator(mode==='mono3d'?'#toBody':'#toSend')).toBeEnabled();
  const before=await page.locator('#calibOut').textContent();await page.evaluate(()=>{window.shiftMarker=true;});await page.waitForTimeout(600);
  expect(await page.locator('#calibOut').textContent()).toBe(before);
  await page.locator(mode==='mono3d'?'#toBody':'#toSend').click();await expect(page.locator(mode==='mono3d'?'[data-panel="body"]':'[data-panel="send"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('marker scanner keeps scanning after a failed calibration until one succeeds',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(h=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;const ctx=canvas.getContext('2d');
      const bits=[[1,0,1,1],[0,1,0,1],[0,0,1,1],[0,0,1,0]];
      const p=(x,y)=>{const w=h[6]*x+h[7]*y+1;return [(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];};
      const fill=(x,y,size,color)=>{ctx.fillStyle=color;ctx.beginPath();[[x,y],[x+size,y],[x+size,y+size],[x,y+size]].forEach(([u,v],i)=>i?ctx.lineTo(...p(u,v)):ctx.moveTo(...p(u,v)));ctx.closePath();ctx.fill();};
      let n=0;const draw=()=>{ctx.fillStyle='#eee';ctx.fillRect(0,0,720,1280);fill(0,0,6,'#000');for(let r=0;r<4;r++)for(let c=0;c<4;c++)if(bits[r][c])fill(c+1,r+1,1,'#fff');ctx.fillStyle=n++%2?'#fff':'#eee';ctx.fillRect(0,0,4,4);};
      draw();setInterval(draw,50);return canvas.captureStream(20);
    };
  },h);
  await page.goto('/test/duo/?key=fragment-test');
  const result=await page.evaluate(async()=>{
    const {createMarkerScanner}=await import('/test/multi3d/auto-marker.js');
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=await navigator.mediaDevices.getUserMedia({video:true});await video.play();
    const status=[],button=document.createElement('button'),hiddenWhileRunning=[];let calls=0;
    return await new Promise(resolve=>{
      const scanner=createMarkerScanner(video,(frame,points)=>{calls++;hiddenWhileRunning.push(button.hidden);if(calls<3)return '모서리 오차 큼';setTimeout(()=>resolve({calls,retries:scanner.retries,running:scanner.running,status,hiddenWhileRunning,hiddenAfter:button.hidden,points,size:[frame.width,frame.height]}),300);},text=>status.push(text),0,{button});
      scanner.start();setTimeout(()=>resolve({calls,retries:scanner.retries,running:scanner.running,status,timeout:true}),30000);
    });
  });
  expect(result.timeout).toBeUndefined();
  expect(result.calls).toBe(3);expect(result.retries).toBe(2);expect(result.running).toBe(false);
  expect(result.hiddenWhileRunning).toEqual([true,true,true]);expect(result.hiddenAfter).toBe(false);
  // Found on the 720 px copy, refined on the full 720x1280 frame: corners land on the drawn edges well within a pixel.
  const truth=[[0,0],[6,0],[6,6],[0,6]].map(([x,y])=>{const w=h[6]*x+h[7]*y+1;return [(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];});
  expect(result.size).toEqual([720,1280]);
  for(let i=0;i<4;i++)expect(Math.hypot(result.points[i][0]-truth[i][0],result.points[i][1]-truth[i][1])).toBeLessThan(.5);
  expect(result.status.some(s=>s.includes('보정 실패 2회, 계속 찾는 중 (모서리 오차 큼)'))).toBe(true);
  expect(errors).toEqual([]);
});
