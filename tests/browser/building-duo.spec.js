import {test,expect} from '@playwright/test';
// Duo stage (docs/DUO_STAGE_TEST.md): synthetic judging phones C0/C1 on markers ID0/ID1 (x = -/+1 m) and a
// view-only phone V on the far side whose video is the main screen.
const calib=id=>({type:'mono3d_calib',marker_id:Number(id[1]),image:{width:640,height:360},K:{fx:420,fy:420,cx:320,cy:180},
  camera:{R:[1,0,0,0,0,-1,0,1,0],t:[0,1,2],C:[0,-2,1]},marker_side_m:.27});
function lookAt(C,target){
  const sub=(a,b)=>a.map((v,i)=>v-b[i]),n=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const f=n(sub(target,C)),x=n(cross(f,[0,0,1])),y=cross(f,x),R=[...x,...y,...f];
  return {R,t:[0,1,2].map(r=>-(R[3*r]*C[0]+R[3*r+1]*C[1]+R[3*r+2]*C[2])),C};
}
const view=spacing=>({type:'wide3d_view_calib',image:{width:1920,height:1080},K:{fx:1250,fy:1250,cx:960,cy:540},
  camera:lookAt([0,3.4,1.6],[0,0,.3]),marker_ids:[0,1],spacing_m:spacing,marker_side_m:.27,reprojection_max_px:.9});

test('duo stage: the far-side view phone is the main screen, the judging phones break buildings',async({page})=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('/test/building/?mode=duo&key=fragment-test');
  await expect(page.locator('#sourceMode')).toContainText('2대 무대');
  await expect(page.locator('#bodyReference')).toContainText('무대 세트 크기 · 몸 보정과 무관');
  await expect(page.locator('#sizePreview')).not.toContainText('허리');
  await expect(page.locator('#stageSpacing')).toHaveValue('2');
  // Stage defaults (2026-11-20, user): auto-next on; whole-building blast, collision with the standing building and
  // support collapse off (blast/collapse come from the server's fresh stage state).
  await expect(page.locator('#autoNext')).toBeChecked();await expect(page.locator('[data-physics="building"]')).not.toBeChecked();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  // AR hit effect (PR #22 module): nothing on the first state, one burst per accepted strike event.
  expect(await page.evaluate(()=>window.__arHitEffect.snapshot().total)).toBe(0);
  await expect(page.locator('#sound')).toHaveText('소리 끄기');
  expect(s.blastEnabled).toBe(false);expect(s.collapse).toBe(false);expect(s.physics.options.building).toBe(false);
  await expect(page.locator('#blastMode')).not.toBeChecked();await expect(page.locator('#collapse')).not.toBeChecked();
  await page.locator('#autoNext').uncheck();   // this test checks one judged break; auto-next is tested in building-zones
  expect(s.sceneId).toMatch(/^duo:/);expect(s.markerX).toEqual([-1,1]);expect(s.stage.layout).toBe('duo');
  await expect(page.locator('#sceneInfo')).toContainText('2대 무대 · 마커 간격 2m');

  await page.evaluate(async({phones,viewCalib})=>{
    window.duoPhones={};
    const open=async id=>{const u=new URL(`/ws/test/duo3d?role=phone&camera=${id}&key=fragment-test`,location.href);u.protocol='ws:';
      const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.duoPhones[id]=ws;return ws;};
    const video=(ws,w,h,color)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,h);
      const packet=JSON.stringify({type:'mono3d_jpeg',data:canvas.toDataURL('image/jpeg')});ws.send(packet);setInterval(()=>{if(ws.readyState===1)ws.send(packet);},250);};
    for(const c of phones){const ws=await open(`C${c.marker_id}`);ws.send(JSON.stringify(c));video(ws,640,360,['#203040','#304020'][c.marker_id]);}
    const v=await open('V');v.send(JSON.stringify(viewCalib));video(v,960,540,'#3a3020');
  },{phones:['C0','C1'].map(calib),viewCalib:view(2)});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(3);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().cameraPanels.every(p=>p.visible))).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.view).toMatchObject({calibrated:true,imageVisible:true});
  // V across the top and much larger; C0 and C1 side by side below it.
  const [V,C0,C1]=s.cameraPanels;
  expect(V.id).toBe('V');expect(V.width).toBeGreaterThan(2.5*C0.width);
  expect(C0.y).toBeGreaterThan(V.y+V.height-2);expect(Math.abs(C0.y-C1.y)).toBeLessThan(2);expect(C0.x).toBeLessThan(C1.x);
  // From the far side +X appears on the left of V's image.
  const P=s.projection.find(p=>p.id==='V').point;expect(Math.abs(P[0])).toBeLessThan(1);expect(Math.abs(P[1])).toBeLessThan(1);expect(P[0]).toBeLessThan(0);
  await expect(page.locator('#stageStatus')).toContainText('V 화면 · 보정됨 · 높이 1.60m');

  // 2026-11-20: one big building centred between the markers, inside the 4 m stage, at least 0.6 m tall.
  expect(s.buildings.length).toBe(1);expect(s.buildings.every(b=>b.height>=.6-1e-6)).toBe(true);
  expect(s.buildings[0].x).toBeCloseTo(-s.buildings.at(-1).x,3);expect(s.worldBounds.hi[0]-s.worldBounds.lo[0]).toBeLessThanOrEqual(4.01);
  // The person on marker ID1 (x = 1 m) beside the right-most building: C1 judges; the depth-only outline is on in V.
  const target=s.buildings.reduce((a,b)=>Math.abs(b.x-1.5)<Math.abs(a.x-1.5)?b:a);
  const lo=s.worldBounds.lo,hi=s.worldBounds.hi,z=Math.min(.2,target.height/2),bx=target.x-1;   // C1 marker frame = stage - 1
  await page.evaluate(async({lo,hi,z,bx})=>{
    const send=(anchor,wrist)=>window.duoPhones.C1.send(JSON.stringify({type:'mono3d_frame',valid:true,anchor_m:[anchor,.3,0],
      joints:{left_hip:[anchor-.1,lo[1]-.6,.9],right_hip:[anchor+.1,lo[1]-.6,.9],left_shoulder:[anchor-.18,lo[1]-.6,1.4],right_shoulder:[anchor+.18,lo[1]-.6,1.4],
        left_knee:[anchor-.1,lo[1]-.6,.5],left_ankle:[anchor-.1,lo[1]-.6,.08],right_wrist:wrist}}));
    // Up to three swings: under load a delayed frame can make one synthetic swing too slow or a tracking gap.
    for(let swing=0;swing<3&&!window.buildingFragmentTest.snapshot().removed.length;swing++){
      send(0,[bx,lo[1]-.8,z]);await new Promise(r=>setTimeout(r,300));   // back out: a fresh path for each swing
      for(const y of [lo[1]-.5,lo[1]-.25,(lo[1]+hi[1])/2]){send(0,[bx,y,z]);await new Promise(r=>setTimeout(r,60));}
      await new Promise(r=>setTimeout(r,400));
    }
    window.duoStanding=setInterval(()=>send(0,[0,lo[1]-.6,1]),100);   // keeps the person live for the outline check
  },{lo,hi,z,bx});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().removed.length),{timeout:10000}).toBeGreaterThan(0);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.owner).toBe('C1');expect(s.removedBuildings.length).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.__arHitEffect.snapshot().total)).toBe(1);
  // Drawn on the main view (V), the judging views and the 3D view, in stage coordinates.
  await expect.poll(()=>page.evaluate(()=>window.__arHitEffect.snapshot().renderedFrames)).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().view.proxy)).toMatchObject({visible:true,torso:true});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/building-fragments/duo-stage.png',fullPage:true});
  await page.evaluate(()=>clearInterval(window.duoStanding));

  // New spacing: V's pose is hidden until the view phone solves again for the new marker positions.
  await page.locator('#stageSpacing').fill('2.4');await page.locator('#applySpacing').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().markerX),{timeout:60000}).toEqual([-1.2,1.2]);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().view.calibrated)).toBe(false);
  await page.evaluate(v=>window.duoPhones.V.send(JSON.stringify(v)),view(2.4));
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().view.calibrated)).toBe(true);
  await page.evaluate(()=>Object.values(window.duoPhones).forEach(ws=>ws.close()));
  expect(errors).toEqual([]);
});

test('duo main screen: the view phone\'s real person outline replaces the joint bars while it is fresh',async({page})=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('/test/building/?mode=duo&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  const spacing=(await page.evaluate(()=>window.buildingFragmentTest.snapshot())).stage.spacing_m;
  await page.evaluate(async({phone,viewCalib})=>{
    window.duoOutline={};
    const open=async id=>{const u=new URL(`/ws/test/duo3d?role=phone&camera=${id}&key=fragment-test`,location.href);u.protocol='ws:';
      const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.duoOutline[id]=ws;return ws;};
    const c1=await open('C1');c1.send(JSON.stringify(phone));
    const v=await open('V');v.send(JSON.stringify(viewCalib));
    // A 1.5 m-deep person box in the middle of V's 384 x 216 depth mask (camera_z_mm_rg16_alpha_v1).
    const mask=document.createElement('canvas');mask.width=384;mask.height=216;const mc=mask.getContext('2d'),img=mc.createImageData(384,216);
    for(let y=40;y<200;y++)for(let x=150;x<230;x++){const i=(y*384+x)*4;img.data[i]=1500>>8;img.data[i+1]=1500&255;img.data[i+3]=255;}
    mc.putImageData(img,0,0);
    const video=document.createElement('canvas');video.width=960;video.height=540;const vc=video.getContext('2d');vc.fillStyle='#3a3020';vc.fillRect(0,0,960,540);
    const jpeg=video.toDataURL('image/jpeg'),png=mask.toDataURL('image/png');
    window.duoOutlineOn=true;window.duoKeepEvery=1;let n=0;
    window.duoOutlineTimer=setInterval(()=>{
      // Every duoKeepEvery-th frame carries a new outline; the others are video only (occlusion_keep).
      const fresh=n++%window.duoKeepEvery===0;
      if(v.readyState===1)v.send(JSON.stringify(fresh?{type:'mono3d_jpeg',data:jpeg,t_ms:Math.round(performance.now()),
        occlusion:window.duoOutlineOn?{encoding:'camera_z_mm_rg16_alpha_v1',width:384,height:216,data:png}:null,
        occlusion_valid:window.duoOutlineOn,occlusion_reason:window.duoOutlineOn?'실제 사람 가림 · 합성':'가림 보류 · 합성'}
        :{type:'mono3d_jpeg',data:jpeg,t_ms:Math.round(performance.now()),occlusion_keep:window.duoOutlineOn,occlusion_valid:window.duoOutlineOn,occlusion_reason:'영상만'}));
      if(c1.readyState===1)c1.send(JSON.stringify({type:'mono3d_frame',valid:true,anchor_m:[0,.3,0],
        joints:{left_hip:[-.1,-.6,.9],right_hip:[.1,-.6,.9],left_shoulder:[-.18,-.6,1.4],right_shoulder:[.18,-.6,1.4]}}));
    },120);
  },{phone:calib('C1'),viewCalib:view(spacing)});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().view?.occlusion?.visible),{timeout:15000}).toBe(true);
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.view.proxy.visible).toBe(false);expect(s.view.occlusionReason).toContain('실제 사람 가림');
  await expect(page.locator('#occlusionStatus')).toContainText('V 실제 사람 윤곽 가림');
  // Video every 120 ms, outline every 3rd frame (360 ms): the outline stays on between outline frames.
  await page.evaluate(()=>{window.duoKeepEvery=3;});
  const samples=[];
  for(let i=0;i<15;i++){await page.waitForTimeout(100);samples.push(await page.evaluate(()=>{const v=window.buildingFragmentTest.snapshot().view;return {on:v.occlusion.visible,age:v.depthAgeMs,id:v.occlusion.frameId};}));}
  expect(samples.every(x=>x.on)).toBe(true);
  expect(Math.max(...samples.map(x=>x.age))).toBeLessThan(500);
  expect(new Set(samples.map(x=>x.id)).size).toBeLessThan(samples.length);   // kept, not reloaded every frame
  await page.evaluate(()=>{window.duoKeepEvery=1;});
  // Outline gone: the judging phone's joint bars take over on V.
  await page.evaluate(()=>{window.duoOutlineOn=false;});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().view.proxy.visible),{timeout:10000}).toBe(true);
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).view.occlusion.visible).toBe(false);
  await expect(page.locator('#occlusionStatus')).toContainText('판정 관절 막대');
  await page.evaluate(()=>{clearInterval(window.duoOutlineTimer);Object.values(window.duoOutline).forEach(ws=>ws.close());});
  expect(errors).toEqual([]);
});

test('duo phone pages: judging phones C0/C1 with A3 and 0.66 m defaults, the view phone page loads',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/mono3d/?stage=duo&camera=C1&key=fragment-test');
  await expect(page.locator('[data-wide-camera="C1"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('[data-wide-camera="C1"]')).toContainText('오른쪽');
  await expect(page.locator('[data-wide-camera="C2"]')).toBeHidden();
  await expect(page.locator('#cameraHeight')).toHaveValue('0.66');await expect(page.locator('#markerCm')).toHaveValue('27');
  await expect(page.locator('#autoMarkerStatus')).toContainText('ID1');
  await expect(page.locator('#pcLinkHint a').first()).toHaveAttribute('href','/test/building/?mode=duo');
  await page.goto('/test/stage-view/?key=fragment-test');
  await expect(page.locator('#cameraHeight')).toHaveValue('1.6');await expect(page.locator('#markerCm')).toHaveValue('27');
  await expect(page.locator('#linkStatus')).toContainText('서버 연결됨');
  await expect(page.locator('#videoFps')).toHaveValue('15');await expect(page.locator('#maskFps')).toHaveValue('8');
  await expect(page.locator('#personMask')).toBeChecked();await expect(page.locator('#personStatus')).toContainText('사람 윤곽 대기');
  // The server keeps the stage between tests: whatever the spacing, the markers sit at -/+spacing/2.
  await expect.poll(()=>page.evaluate(()=>{const st=window.stageView.snapshot().stage;return !!st&&st.markers[0]===-st.spacing/2&&st.markers[1]===st.spacing/2;})).toBe(true);
  expect(errors).toEqual([]);
});

test('view phone: the recognise button hides while both markers are searched and returns once they solve',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Fake 1280x720 camera: draws whatever marker quads the test sets (ID0/ID1 projected from a far-side pose).
  await context.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
      const draw=()=>{ctx.fillStyle='#d8d8d8';ctx.fillRect(0,0,1280,720);
        for(const m of window.fakeMarkers??[]){const cell=(c,r,color)=>{ctx.fillStyle=color;ctx.beginPath();[[c,r],[c+1,r],[c+1,r+1],[c,r+1]].forEach(([x,y],i)=>{const p=m.at(x,y);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.fill();};
          for(let r=0;r<6;r++)for(let c=0;c<6;c++)cell(c,r,r>0&&r<5&&c>0&&c<5&&m.bits[r-1][c-1]?'#e5e5e5':'#111');}};
      draw();setInterval(draw,50);return canvas.captureStream(20);
    };
  });
  await page.route('**/camera/pose.js*',route=>route.fulfill({contentType:'application/javascript',body:"export async function createPoseLandmarker(){return {delegate:'CPU',landmarker:{detectForVideo(){return {landmarks:[],worldLandmarks:[]}},close(){}}};}"}));
  await page.goto('/test/stage-view/?key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>!!window.stageView.snapshot().stage)).toBe(true);
  await page.locator('#start').click();await expect(page.locator('#scan')).toBeEnabled();
  await page.locator('#scan').click();await expect(page.locator('#scan')).toBeHidden();
  await page.waitForTimeout(800);await expect(page.locator('#scan')).toBeHidden();   // nothing to find yet: still searching
  await page.evaluate(async()=>{
    const g=await import('/test/mono3d/geometry.js');const {MARKER_BITS}=await import('/test/multi3d/aruco.js');
    const st=window.stageView.snapshot().stage,K=g.intrinsicsFromFov(1280,720,70),C=[.1,3.2,1.6];
    const f=g.normalize(g.sub([0,0,.2],C)),x=g.normalize(g.cross(f,[0,0,1])),y=g.cross(f,x),R=[...x,...y,...f];
    const pose={R,t:[0,1,2].map(r=>-(R[3*r]*C[0]+R[3*r+1]*C[1]+R[3*r+2]*C[2])),C},a=.135,cell=.27/6;
    window.fakeMarkers=[0,1].map(id=>({bits:MARKER_BITS[id],at:(c,r)=>g.project(K,pose,[st.markers[id]-a+c*cell,a-r*cell,0])}));
  });
  await expect(page.locator('#scanStatus')).toHaveText('두 마커 인식 완료',{timeout:20000});
  await expect(page.locator('#scan')).toBeVisible();
  await expect(page.locator('#layoutStatus')).toContainText('실측 간격');
  expect(errors).toEqual([]);
});

test('main page ends with phone and PC entry buttons; the phone page picks a role and keeps the key',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/monitor/?key=fragment-test');
  const entry=page.locator('nav.entry-buttons a');
  await expect(entry).toHaveCount(2);
  await expect(entry.nth(0)).toHaveText('폰으로 입장');await expect(entry.nth(0)).toHaveAttribute('href','/test/duo/');
  await expect(entry.nth(1)).toHaveText('PC로 입장');await expect(entry.nth(1)).toHaveAttribute('href','/test/building/?mode=duo');
  // The entry section is the last one on the page.
  expect(await page.evaluate(()=>[...document.querySelectorAll('main > section')].at(-1).querySelector('nav.entry-buttons')!==null)).toBe(true);
  await page.goto('/test/duo/?key=fragment-test');
  const roles=page.locator('[data-role]');
  await expect(roles).toHaveCount(3);
  await expect(roles.nth(0)).toHaveAttribute('href','/test/mono3d/?stage=duo&camera=C0&key=fragment-test');
  await expect(roles.nth(1)).toHaveAttribute('href','/test/mono3d/?stage=duo&camera=C1&key=fragment-test');
  await expect(roles.nth(2)).toHaveAttribute('href','/test/stage-view/?key=fragment-test');
  await roles.nth(1).click();
  await expect(page.locator('[data-wide-camera="C1"]')).toHaveAttribute('aria-checked','true');
  expect(errors).toEqual([]);
});

test('duo PC shows the view phone\'s measured marker layout and applies the measured spacing',async({page})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?mode=duo&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  const spacing=(await page.evaluate(()=>window.buildingFragmentTest.snapshot())).stage.spacing_m,measured=Math.round((spacing+.05)*1000)/1000;
  // Manual flow first: auto spacing off (2026-11-20 default is on, checked at the end).
  await expect(page.locator('#autoSpacing')).toBeChecked();
  await page.locator('#autoSpacing').uncheck();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().view.autoSpacing)).toBe(false);
  await page.waitForTimeout(300);
  await page.evaluate(async({measured,spacing})=>{
    const u=new URL('/ws/test/duo3d?role=phone&camera=V&key=fragment-test',location.href);u.protocol='ws:';
    const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.duoLayoutV=ws;
    ws.send(JSON.stringify({type:'wide3d_view_layout',spacing_m:measured,entered_spacing_m:spacing,yaw_deg:[-.8,2.6],relative_yaw_deg:3.4,reprojection_max_px:.6,warn:['spacing','yaw']}));
  },{measured,spacing});
  await expect(page.locator('#stageStatus')).toContainText(`V 실측 · 간격 ${measured.toFixed(3)}m`);
  await expect(page.locator('#stageStatus')).toContainText('ID1 +2.6°');
  await expect(page.locator('#stageStatus')).toContainText('1.5m 앞 옆 어긋남 약 7cm');
  await expect(page.locator('#stageStatus')).toContainText('두 마커 중심선에 맞게 돌려');
  const button=page.locator('#applyMeasuredSpacing');
  await expect(button).toBeVisible();await expect(button).toContainText(measured.toFixed(3));
  await button.click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().stage.spacing_m),{timeout:60000}).toBe(measured);
  await expect(page.locator('#stageSpacing')).toHaveValue(String(measured));
  await expect(button).toBeHidden();   // measured and entered agree now
  // Auto on: a new measurement becomes the stage spacing by itself, no button.
  await page.locator('#autoSpacing').check();
  const auto=Math.round((measured+.1)*1000)/1000;
  await page.evaluate(({auto,measured})=>window.duoLayoutV.send(JSON.stringify({type:'wide3d_view_layout',spacing_m:auto,entered_spacing_m:measured,yaw_deg:[0,0],relative_yaw_deg:0,reprojection_max_px:.5,warn:['spacing']})),{auto,measured});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().stage.spacing_m),{timeout:60000}).toBe(auto);
  await expect(page.locator('#stageSpacing')).toHaveValue(String(auto));
  await expect(button).toBeHidden();
  await page.evaluate(()=>window.duoLayoutV.close());
  await expect(page.locator('#stageStatus')).not.toContainText('V 실측');
  // Put the stage back to the default for later tests.
  await page.locator('#stageSpacing').fill('2');await page.locator('#applySpacing').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().stage.spacing_m),{timeout:60000}).toBe(2);
  expect(errors).toEqual([]);
});
