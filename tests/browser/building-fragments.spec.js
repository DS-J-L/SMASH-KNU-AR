import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const data=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',
  "import sys,json;sys.path.insert(0,'tests');from test_fragment_test import browser_case;print(json.dumps(browser_case()))"],{encoding:'utf8'}));
test('a delayed server option snapshot cannot undo the checkbox before its acknowledgement',async({page})=>{
  let lastState,delayed=0;
  await page.routeWebSocket('**/ws/test/mono3d**',route=>{
    const server=route.connectToServer();
    server.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='mono3d_model_state')lastState=m;route.send(raw);});
    route.onMessage(raw=>{
      const m=JSON.parse(String(raw));
      if(m.type==='multi3d_model_blast_config'&&m.enabled===false&&lastState){
        route.send(JSON.stringify(lastState));delayed++;
        setTimeout(()=>server.send(raw),250);
      }else server.send(raw);
    });
  });
  await page.goto('/test/building/?mode=mono&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest?.snapshot().ready)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().connected)).toBe(true);
  await page.locator('#blastMode').check();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(true);
  await page.locator('#blastMode').uncheck();
  await expect(page.locator('#blastMode')).not.toBeChecked();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(false);
  expect(delayed).toBe(1);
});
test('actual IT1 on the marker: one touched fragment, camera projection, restore and reconnect',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?scene=it1&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest?.snapshot().ready)).toBe(true);
  await expect(page.locator('#status')).not.toContainText('실패');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().connected)).toBe(true);
  await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#collapse').uncheck();await page.locator('#impactBreak').uncheck();
  await page.locator('#blastMode').uncheck();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().collapse)).toBe(false);
  const initial=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(initial.visible).toHaveLength(96);
  expect(initial.worldBounds.lo[2]).toBeCloseTo(0,3);
  expect(initial.worldBounds.hi[2]).toBeCloseTo(1.0844383*.6,3);
  await page.evaluate(async data=>{
    window.syntheticPhones={};window.syntheticClockReplies={};
    for(const c of Object.keys(data.calibs)){
      const url=new URL('/ws/test/multi3d',location.href);url.protocol='ws:';url.search=new URLSearchParams({role:'phone',camera:c,key:'fragment-test',input_mode:'synthetic'});
      const ws=new WebSocket(url);window.syntheticClockReplies[c]=0;
      ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='multi3d_clock_ping'){
        ws.send(JSON.stringify({type:'multi3d_clock_pong',nonce:m.nonce,clock_id:c,device_time_ms:performance.now()}));window.syntheticClockReplies[c]++;
      }else if(m.type==='multi3d_fused'){
        window.syntheticLastFused=m;
        if(m.timing==='inference_input_aligned'&&m.cameras_used.length===3&&m.joints?.right_wrist)window.sendAfterCapturedBaseline?.();
      }else if(m.type==='error')window.syntheticLastError=m;};
      await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.syntheticPhones[c]=ws;ws.send(JSON.stringify(data.calibs[c]));
      // Synthetic camera image with a projected ground marker, not a live phone photo.
      const canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#17202d';ctx.fillRect(0,0,canvas.width,canvas.height);
      const {R,t}=data.calibs[c],P=v=>{const q=[0,1,2].map(r=>R[r*3]*v[0]+R[r*3+1]*v[1]+R[r*3+2]*v[2]+t[r]);return [data.K.fx*q[0]/q[2]+data.K.cx,data.K.fy*q[1]/q[2]+data.K.cy];};
      ctx.strokeStyle='#22c55e';ctx.lineWidth=4;ctx.beginPath();[[-.1,.1,0],[.1,.1,0],[.1,-.1,0],[-.1,-.1,0]].forEach((p,i)=>i?ctx.lineTo(...P(p)):ctx.moveTo(...P(p)));ctx.closePath();ctx.stroke();
      ws.send(JSON.stringify({type:'multi3d_jpeg',data:canvas.toDataURL('image/jpeg')}));
    }
  },data);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(3);
  await expect(page.locator('.camera img').first()).toBeVisible();
  // Matrix used by WebGL overlay must exactly match the server's OpenCV pinhole projection.
  const projected=await page.evaluate(()=>window.buildingFragmentTest.snapshot().projection);
  for(const p of projected){const {R,t}=data.calibs[p.id],v=[.1,.1,.3],q=[0,1,2].map(r=>R[r*3]*v[0]+R[r*3+1]*v[1]+R[r*3+2]*v[2]+t[r]);
    expect(p.point[0]).toBeCloseTo(2*(data.K.fx*q[0]/q[2]+data.K.cx)/data.width-1,6);
    expect(p.point[1]).toBeCloseTo(1-2*(data.K.fy*q[1]/q[2]+data.K.cy)/data.height,6);}
  // Model a captured 40ms motion, independent of GPU warmup or interleaved socket arrival.
  await expect.poll(()=>page.evaluate(()=>Object.values(window.syntheticClockReplies).every(n=>n>=3))).toBe(true);
  await page.evaluate(data=>new Promise((resolve,reject)=>{
    let stamp,timer;
    const send=()=>{stamp=performance.now()-80;
      for(const c of Object.keys(data.calibs))window.syntheticPhones[c].send(JSON.stringify({type:'multi3d_frame',clock_id:c,input_at_ms:stamp,landmarks:data.before[c]}));
    };
    const timeout=setTimeout(()=>{clearInterval(timer);window.sendAfterCapturedBaseline=null;
      const m=window.syntheticLastFused;reject(new Error(JSON.stringify({error:window.syntheticLastError,timing:m?.timing,cameras:m?.cameras,reasons:m?.reasons})));},10000);
    window.sendAfterCapturedBaseline=()=>{
      window.sendAfterCapturedBaseline=null;clearInterval(timer);clearTimeout(timeout);
      for(const c of Object.keys(data.calibs))window.syntheticPhones[c].send(JSON.stringify({type:'multi3d_frame',clock_id:c,input_at_ms:stamp+40,landmarks:data.after[c]}));
      resolve();
    };
    timer=setInterval(send,100);send();
  }),data);
  await expect(page.locator('#count')).toHaveText('1 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('1점 · 파편 1개당 1점');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(1);
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).visible).toHaveLength(96);
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).removed).toEqual([data.fragment_id]);
  await page.screenshot({path:'test-results/building-fragments/one-fragment.png',fullPage:true});
  await page.locator('#restore').click();
  await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().visible.length)).toBe(96);
  // Losing all real input must not synthesize new contacts.
  await page.evaluate(()=>Object.values(window.syntheticPhones).forEach(s=>s.close()));
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest?.snapshot().visible.length)).toBe(96);
  expect(errors).toEqual([]);
});

test('already released fragments accept another directional mouse push',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?scene=it1&key=fragment-test');await expect(page.locator('#dimensions')).toContainText('고정 높이');
  for(const name of ['gravity','building','debris'])await page.locator(`[data-physics="${name}"]`).uncheck();
  await page.locator('#impactBreak').uncheck();await page.locator('#stress').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(96);
  await page.locator('#orbit canvas').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.mousePushes)).toBe(1);
  await expect(page.locator('#count')).toHaveText('96 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('96점 · 파편 1개당 1점');
  await expect(page.locator('#contact')).toContainText('화면 안쪽으로 밀기');
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).physics.finite).toBe(true);
  await page.locator('#restore').click();expect(errors).toEqual([]);
});

test('all physics enabled: 96-piece fall, switches, finite state and repeatable restoration',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?scene=it1&key=fragment-test');
  await expect(page.locator('#dimensions')).toContainText('고정 높이');
  // Keep all three calibrated overlays rendering during the load measurement.
  await page.evaluate(async data=>{
    window.loadPhones=[];const canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#17202d';ctx.fillRect(0,0,canvas.width,canvas.height);
    const jpeg=JSON.stringify({type:'multi3d_jpeg',data:canvas.toDataURL('image/jpeg')});
    for(const c of Object.keys(data.calibs)){
      const url=new URL('/ws/test/multi3d',location.href);url.protocol='ws:';url.search=new URLSearchParams({role:'phone',camera:c,key:'fragment-test'});
      const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
      window.loadPhones.push(ws);ws.send(JSON.stringify(data.calibs[c]));ws.send(jpeg);
    }
    window.loadTimer=setInterval(()=>window.loadPhones.forEach(ws=>{if(ws.readyState===1)ws.send(jpeg);}),250);
  },data);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(3);
  await page.locator('#collapse').check();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().collapse)).toBe(true);
  await page.locator('#stress').click();
  await expect(page.locator('#count')).toHaveText('96 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('96점 · 파편 1개당 1점');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(96);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.steps),{timeout:20000}).toBeGreaterThan(120);
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.physics.finite).toBe(true);expect(s.physics.minZ).toBeGreaterThan(-.03);
  expect(s.physics.bodies).toBe(97);expect(s.physics.options).toEqual({gravity:true,floor:true,building:true,debris:true,rotation:true,sleep:true,hand:true});
  console.log('Browser 96-piece physics load',JSON.stringify({fps:s.fps,frameCpuMs:s.frameCpuMs,physics:s.physics}));
  await page.screenshot({path:'test-results/building-fragments/physics-96.png',fullPage:true});
  for(const name of ['debris','building','gravity','rotation','sleep']){
    await page.locator(`[data-physics="${name}"]`).uncheck();
    expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).physics.options[name]).toBe(false);
  }
  await page.locator('#restore').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(0);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.physics.bodies).toBe(97);expect(s.removed).toHaveLength(0);
  await page.locator('#stress').click();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(96);
  await page.locator('#restore').click();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(0);
  await page.evaluate(()=>{clearInterval(window.loadTimer);window.loadPhones.forEach(s=>s.close());});
  expect(errors).toEqual([]);
});

test('mouse without phones: OFF and orbit drag do not hit, click releases a real fragment',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?scene=it1&key=fragment-test');
  await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#collapse').uncheck();await page.locator('#impactBreak').uncheck();
  await page.locator('#blastMode').uncheck();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().collapse)).toBe(false);
  const canvas=page.locator('#orbit canvas');
  await page.locator('#mouseMode').uncheck();await canvas.click();
  await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await page.locator('#mouseMode').check();
  const rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2+90,rect.y+rect.height/2,{steps:8});await page.mouse.up();
  await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await page.reload();await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#impactBreak').uncheck();
  await canvas.click({position:{x:8,y:8}});await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await canvas.click();
  await expect(page.locator('#count')).toHaveText('1 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('1점 · 파편 1개당 1점');
  await expect(page.locator('#contact')).toContainText('마우스 합성 타격');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.mousePushes)).toBe(1);
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).physics.finite).toBe(true);
  await page.screenshot({path:'test-results/building-fragments/mouse-hit.png',fullPage:true});
  await page.locator('#restore').click();await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  expect(errors).toEqual([]);
});

test('wide mouse strike launches the whole IT1 and distance limit remains adjustable',async({page})=>{
  await page.goto('/test/building/?scene=it1&key=fragment-test');await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#blastMode').check();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(true);
  await page.locator('#orbit canvas').click();
  await expect(page.locator('#count')).toHaveText('96 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('96점 · 파편 1개당 1점');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.blasts)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(96);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().worldBounds.hi[2])).toBeGreaterThan(1);
  await page.screenshot({path:'test-results/building-fragments/wide-blast.png',fullPage:true});
  await page.locator('#interactionDistance').fill('0.25');await page.locator('#interactionDistance').dispatchEvent('change');
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).physics.interactionDistance).toBe(.25);
  expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).physics.finite).toBe(true);
  await page.locator('#restore').click();
});

test('one approximate camera: model overlay, wrist blast and mouse restore use the mono relay',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?mode=mono&key=fragment-test');
  await expect(page.locator('#sourceMode')).toContainText('mono_approx');
  await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await expect(page.locator('.camera')).toHaveCount(1);
  await page.locator('#restore').click();await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await page.locator('#blastMode').check();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(true);
  await page.evaluate(async data=>{
    const url=new URL('/ws/test/mono3d',location.href);url.protocol='ws:';url.search='?role=phone&key=fragment-test';
    const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.monoPhone=ws;
    const c=data.calibs.C0;ws.send(JSON.stringify({type:'mono3d_calib',image:c.image,K:c.K,camera:{R:c.R,t:c.t,C:[0,-2.5,1]}}));
    const canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#17202d';ctx.fillRect(0,0,canvas.width,canvas.height);
    ws.send(JSON.stringify({type:'mono3d_jpeg',data:canvas.toDataURL('image/jpeg')}));
    // Send direct approximate 3D points using the shipped mono protocol.
    const {origin,end}=data;
    ws.send(JSON.stringify({type:'mono3d_frame',valid:true,joints:{right_wrist:origin}}));
    // Consecutive synthetic samples use the high-resolution server clock. A browser timer
    // may stretch during first GPU uploads and would accidentally test a slow gesture.
    ws.send(JSON.stringify({type:'mono3d_frame',valid:true,joints:{right_wrist:end}}));
  },{...data,...JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',
    "import sys,json;sys.path.insert(0,'tests');from backend.fragment_test import FragmentTest;from test_fragment_test import approach;a,b,_=approach(FragmentTest());print(json.dumps({'origin':a,'end':b}))"],{encoding:'utf8'}))});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(1);
  await expect(page.locator('#count')).toHaveText('96 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('96점 · 파편 1개당 1점');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.blasts)).toBe(1);
  await page.screenshot({path:'test-results/building-fragments/mono-building.png',fullPage:true});
  await page.locator('#restore').click();await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await page.locator('#orbit canvas').click();await expect(page.locator('#count')).toHaveText('96 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('96점 · 파편 1개당 1점');
  await page.evaluate(()=>window.monoPhone.close());
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.activeHands)).toBe(0);
  await page.locator('#restore').click();await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  expect(errors).toEqual([]);
});

test('mono depth offset: strict miss becomes a deliberate swing hit with an explicit allowance',async({page})=>{
  await page.goto('/test/building/?mode=mono&key=fragment-test');await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#restore').click();await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await page.locator('#blastMode').check();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(true);
  await page.locator('#depthMargin').fill('0');await page.locator('#depthMargin').dispatchEvent('change');
  await page.evaluate(async()=>{const u=new URL('/ws/test/mono3d?role=phone&key=fragment-test',location.href);u.protocol='ws:';
    const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.depthPhone=ws;
    ws.send(JSON.stringify({type:'mono3d_frame',valid:true,joints:{right_wrist:[0,.4527,.3339]}}));
    await new Promise(r=>setTimeout(r,80));ws.send(JSON.stringify({type:'mono3d_frame',valid:true,joints:{right_wrist:[-.1155,.4527,.3339]}}));});
  await expect(page.locator('#trackingDiagnosis')).toContainText('충돌체 밖');await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  await page.locator('#depthMargin').fill('0.3');await page.locator('#depthMargin').dispatchEvent('change');
  await page.evaluate(async()=>{window.depthPhone.send(JSON.stringify({type:'mono3d_frame',valid:true,joints:{right_wrist:[0,.4527,.3339]}}));
    await new Promise(r=>setTimeout(r,80));window.depthPhone.send(JSON.stringify({type:'mono3d_frame',valid:true,joints:{right_wrist:[-.1155,.4527,.3339]}}));});
  await expect(page.locator('#count')).toHaveText('96 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('96점 · 파편 1개당 1점');
  await expect(page.locator('#trackingDiagnosis')).toContainText('0.27m');
  await page.evaluate(()=>window.depthPhone.close());await page.locator('#restore').click();
});

test('size slider and numeric scale update render and collision placement in both modes',async({page})=>{
  for(const mode of ['', '?mode=mono']){
    await page.goto(`/test/building/${mode}${mode?'&':'?scene=it1&'}key=fragment-test`);
    await expect(page.locator('#dimensions')).toContainText('고정 높이');
    await page.locator('#restore').click();
    const old=(await page.evaluate(()=>window.buildingFragmentTest.snapshot())).placement.scale;
    await page.locator('#sizeRange').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await expect(page.locator('#scale')).toHaveValue('1');await expect(page.locator('#sizePreview')).toContainText('1.08m');
    // Incoming state updates must not overwrite an un-applied size draft.
    await page.locator('#blastMode').dispatchEvent('change');
    await expect(page.locator('#scale')).toHaveValue('1');
    expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).placement.scale).toBe(old);
    await page.locator('#applySize').click();
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().placement.scale)).toBe(1);
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().worldBounds.hi[2])).toBeCloseTo(1.0844,3);
    await page.locator('#scale').fill('0.3');await page.locator('#applySize').click();
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().placement.scale)).toBe(.3);
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().worldBounds.hi[2])).toBeCloseTo(.32533,3);
    expect((await page.evaluate(()=>window.buildingFragmentTest.snapshot())).physics.dynamic).toBe(0);
    await page.locator('#scale').fill('0.6');await page.locator('#applySize').click();
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().placement.scale)).toBe(.6);
  }
});

test('marker body reference drives strict depth contacts and rejects frames without visible feet',async({page})=>{
  await page.goto('/test/building/?mode=mono&key=fragment-test');
  await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#depthMargin').fill('0');await page.locator('#depthMargin').dispatchEvent('change');
  await page.locator('#blastMode').uncheck();await page.locator('#collapse').uncheck();await page.locator('#impactBreak').uncheck();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(false);
  await page.locator('#restore').click();await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  const points=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',
    "import sys,json;sys.path.insert(0,'tests');from backend.fragment_test import FragmentTest;from test_fragment_test import approach;a,b,_=approach(FragmentTest());print(json.dumps([a,b]))"],{encoding:'utf8'}));
  const reference=await page.evaluate(async()=>{
    const g=await import('/test/mono3d/geometry.js'),m=await import('/test/mono3d/mono3d.js?v=20261112-1');
    const C=[.1,-2.2,1.1],f=g.normalize(g.sub([0,0,.8],C)),r=g.normalize(g.cross(f,[0,0,1])),d=g.cross(f,r),R=[...r,...d,...f];
    const pose={R,t:g.scale(g.matVec(R,C),-1),C},K=g.intrinsicsFromFov(720,1280,80);
    function person(wrist,y,feet=true){
      const P={0:[0,y,1.6],11:[-.18,y,1.45],12:[.18,y,1.45],15:[-.3,y,1.1],16:wrist,
        23:[-.1,y,.95],24:[.1,y,.95],27:[-.1,y,.09],28:[.1,y,.09]};
      const landmarks=[],world=[];
      for(let i=0;i<33;i++){
        if(!P[i]){landmarks.push({x:0,y:0,visibility:0});world.push({x:0,y:0,z:0});continue;}
        const [u,v]=g.project(K,pose,P[i]),w=g.scale(g.matVec(R,g.sub(P[i],[0,y,.95])),.9);
        landmarks.push({x:u/720,y:v/1280,visibility:!feet&&[27,28].includes(i)?0:.95});world.push({x:w[0],y:w[1],z:w[2]});
      }return {landmarks,world};
    }
    const p=person([.3,0,1.1],0),sample=m.measureBody(K,pose,p.landmarks,p.world,{markerCentered:true});
    const body=m.finalizeBody(Array(15).fill(sample),null,{markerCentered:true});
    if(!body)throw new Error('synthetic marker body reference failed');
    const u=new URL('/ws/test/mono3d?role=phone&key=fragment-test',location.href);u.protocol='ws:';
    const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.markerPhone=ws;
    ws.send(JSON.stringify({type:'mono3d_calib',image:{width:720,height:1280},K,camera:pose,body}));
    window.sendMarkerEstimate=(wrist,feet)=>{
      const p=person(wrist,.7,feet),e=m.estimate(K,pose,p.landmarks,p.world,body);
      ws.send(JSON.stringify({type:'mono3d_frame',valid:e.valid,reason:e.reason,
        joints:e.valid?Object.fromEntries(Object.entries(e.joints).map(([key,j])=>[key,j?.position_m??null])):null}));
      return e;
    };return body.depth_reference;
  });
  expect(reference.point_m).toEqual([0,0,0]);
  for(const p of points){await page.evaluate(p=>window.sendMarkerEstimate([p[0],p[1]+.6,p[2]],true),p);await page.waitForTimeout(80);}
  await expect(page.locator('#trackingDiagnosis')).toContainText('충돌체 밖');await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  for(const p of points){const e=await page.evaluate(p=>window.sendMarkerEstimate(p,false),p);expect(e.valid).toBe(false);await page.waitForTimeout(80);}
  await expect(page.locator('#status')).toContainText('발목 미검출');await expect(page.locator('#count')).toHaveText('0 / 96개 파괴');
  await expect(page.locator('#score')).toHaveText('0점 · 파편 1개당 1점');
  for(const p of points){await page.evaluate(p=>window.sendMarkerEstimate(p,true),p);await page.waitForTimeout(80);}
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().removed.length)).toBeGreaterThan(0);
  const help=await page.request.get('/test/mono3d/');expect(await help.text()).toContain('두 발 사이 중심을 마커 중심');
  await page.evaluate(()=>window.markerPhone.close());
});
