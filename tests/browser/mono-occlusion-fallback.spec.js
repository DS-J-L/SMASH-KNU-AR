import {test,expect} from '@playwright/test';
import * as g from '../../web/test/mono3d/geometry.js';

// One phone, real page flow (marker → body → measure) with a stubbed pose model whose segmentation is
// blank or misplaced. Occlusion must still be prepared from the skeleton and the phone must say why.
const W=720,H=1280,SIDE=.6,C=[.1,-2.2,1.1];
const f=g.normalize(g.sub([0,0,.8],C)),r=g.normalize(g.cross(f,[0,0,1])),d=g.cross(f,r),R=[...r,...d,...f];
const pose={R,t:g.scale(g.matVec(R,C),-1),C},K=g.intrinsicsFromFov(W,H,80);
const corners=[[-1,1],[1,1],[1,-1],[-1,-1]].map(([x,y])=>g.project(K,pose,[x*SIDE/2,y*SIDE/2,0]));
const h=g.homography([[0,0],[6,0],[6,6],[0,6]],corners);
const joints={0:[0,0,1.6],11:[-.18,0,1.45],12:[.18,0,1.45],13:[-.28,0,1.2],14:[.28,0,1.2],15:[-.3,0,1.1],16:[.3,0,1.1],
  23:[-.1,0,.95],24:[.1,0,.95],25:[-.1,0,.5],26:[.1,0,.5],27:[-.1,0,.09],28:[.1,0,.09]};
const landmarks=[],world=[];
for(let i=0;i<33;i++){
  if(!joints[i]){landmarks.push({x:0,y:0,visibility:0});world.push({x:0,y:0,z:0});continue;}
  const [u,v]=g.project(K,pose,joints[i]),w=g.scale(g.matVec(R,g.sub(joints[i],[0,0,.95])),.9);
  landmarks.push({x:u/W,y:v/H,visibility:.95});world.push({x:w[0],y:w[1],z:w[2]});
}

for(const kind of ['blank','misplaced'])test(`mono3d phone: ${kind} segmentation falls back to a skeleton silhouette`,async({page,context})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
  const stub=`export async function createPoseLandmarker(){const d=${JSON.stringify({landmarks,world})},kind=${JSON.stringify(kind)};
    const mask={width:720,height:1280,close(){},getAsFloat32Array(){const a=new Float32Array(720*1280);
      if(kind==='misplaced')for(let y=0;y<1280;y++)for(let x=0;x<60;x++)a[y*720+x]=1;return a;}};
    return {delegate:'CPU',landmarker:{detectForVideo(){return {landmarks:[d.landmarks],worldLandmarks:[d.world],segmentationMasks:[mask],close(){}};},close(){}}};}`;
  await page.route('**/camera/pose.js*',route=>route.fulfill({contentType:'application/javascript',body:stub}));
  await page.goto('/test/mono3d/?key=fragment-test');
  await page.locator('#start').click();
  await page.locator('#markerCm').fill(String(SIDE*100));await page.locator('#markerCm').dispatchEvent('change');
  await page.locator('#cameraHeight').fill(String(C[2]));await page.locator('#cameraHeight').dispatchEvent('change');
  await page.locator('#autoMarker').click();await expect(page.locator('#cornerDone')).toBeVisible({timeout:20000});
  await page.locator('#toBody').click();
  await page.locator('#calibBody').click();
  await expect(page.locator('#toMeasure')).toBeVisible({timeout:30000});
  await page.locator('#toMeasure').click();
  await expect(page.locator('#personMaskStatus')).toContainText('가림 준비',{timeout:20000});
  const status=await page.locator('#personMaskStatus').textContent();
  expect(status).toContain('골격 근사 윤곽');
  expect(status).toContain(kind==='blank'?'분할 윤곽이 몸통과 불일치 0%':'분할 윤곽이 몸통과 불일치');
  expect(status).toContain('발목 L ✓ / R ✓');
  expect(errors).toEqual([]);
});
