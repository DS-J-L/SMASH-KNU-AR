import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const fixture=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-X','utf8','-c',
  "import sys,json;sys.path.insert(0,'tests');from test_fragment_test import browser_case;print(json.dumps(browser_case()))"],{encoding:'utf8'}));

for(const preset of ['chain_blast_v1','swing_wave_v1','crush_collapse_v1','gravity_compress_v1'])for(const reducedMotion of [false,true]){
  test('super preset '+preset+(reducedMotion?' with reduced motion':'')+' drives the real event, screen, audio and bounded debris then restores',async({page},testInfo)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const osReduced=reducedMotion&&preset==='gravity_compress_v1';
    if(osReduced)await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/test/building/?scene=it1&key=fragment-test');
    await expect.poll(()=>page.evaluate(()=>{const s=window.buildingFragmentTest?.snapshot();return s?.ready&&s.connected;})).toBe(true);
    await expect(page.locator('#claimControl')).toBeEnabled();await page.locator('#claimControl').click();
    await expect.poll(()=>page.evaluate(()=>{const s=window.buildingFragmentTest.snapshot();return s.modelState.controller_viewer_id===s.viewerId&&!s.controlPending;})).toBe(true);
    await page.locator('#superIt1').click();
    await expect.poll(()=>page.evaluate(()=>{const s=window.buildingFragmentTest.snapshot();return s.sceneId==='it1'&&!s.controlPending&&s.score===0;})).toBe(true);
    await page.locator('#smashMode').selectOption('super_smash');
    await expect.poll(()=>page.evaluate(()=>!window.buildingFragmentTest.snapshot().controlPending)).toBe(true);
    await page.locator('#feedbackStyle').selectOption(preset);
    await expect.poll(()=>page.evaluate(()=>!window.buildingFragmentTest.snapshot().controlPending)).toBe(true);
    if(reducedMotion&&!osReduced)await page.locator('#reduceMotion').check();
    try{
      await phones(page);await page.locator('#playView').click();
      await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.phase),{timeout:20000}).toBe('armed');
      if(preset==='swing_wave_v1'){
        await page.locator('#feedbackStyle').selectOption('gravity_compress_v1');
        await expect.poll(()=>page.evaluate(()=>!window.buildingFragmentTest.snapshot().controlPending)).toBe(true);
        await expect(page.locator('#feedbackHint')).toContainText('다음 준비');
      }
      await page.evaluate(()=>{window.smashPose='after';});
      await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(96);
      await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().super.logs.at(-1)?.firstDraw)).not.toBeNull();
      await page.waitForTimeout(180);
      const result=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
      expect(result.modelState.event?.feedback_preset??result.super.logs.at(-1).preset).toBe(preset);
      expect(result.super.eventCount).toBe(1);expect(result.super.logs.at(-1).preset).toBe(preset);
      expect(result.super.logs.at(-1).firstDraw).toBeGreaterThanOrEqual(result.super.logs.at(-1).received);
      expect(result.super.logs.at(-1).firstDraw-result.super.logs.at(-1).received).toBeLessThanOrEqual(100);
      expect(result.super.audio.preset).toBe(preset);expect(result.physics.superPreset).toBe(preset);
      expect(result.physics.dynamic).toBeLessThanOrEqual(128);expect(result.physics.finite).toBe(true);
      if(reducedMotion){expect(result.physics.dynamic).toBe(0);expect(result.physics.superVisual).toBe(0);expect(result.physics.superHidden).toBe(96);}
      else if(preset==='gravity_compress_v1'){expect(result.physics.dynamic).toBe(0);expect(result.physics.superVisual).toBeGreaterThan(0);expect(result.physics.superVisual).toBeLessThanOrEqual(64);}
      await page.screenshot({path:testInfo.outputPath('live-synthetic-'+preset+'.png')});
      writeFileSync(testInfo.outputPath('feedback-state.json'),JSON.stringify(result,null,2));
      if(!reducedMotion&&['chain_blast_v1','gravity_compress_v1'].includes(preset)){
        await page.locator('#reduceMotion').check();
        const stopped=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
        expect(stopped.score).toBe(96);expect(stopped.physics.dynamic).toBe(0);expect(stopped.physics.superVisual).toBe(0);
        expect(stopped.physics.superHidden).toBe(96);await expect(page.locator('#screenImpact')).toBeHidden();
      }
      await page.locator('#superRestore').click();
      await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(0);
      await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().visible.length)).toBe(96);
      const restored=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
      expect(restored.physics.superVisual).toBe(0);expect(restored.physics.dynamic).toBe(0);
      await page.locator('#smashMode').selectOption('normal');
      await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.smash_mode)).toBe('normal');
      await expect.poll(()=>page.evaluate(()=>!window.buildingFragmentTest.snapshot().controlPending)).toBe(true);
      await page.locator('#feedbackStyle').selectOption('chain_blast_v1');
      await expect.poll(()=>page.evaluate(()=>!window.buildingFragmentTest.snapshot().controlPending)).toBe(true);
      expect(errors).toEqual([]);
    }finally{
      await page.evaluate(()=>{clearInterval(window.smashLoop);Object.values(window.smashSockets??{}).forEach(s=>s.close());});
    }
  });
}

async function phones(page,pose='before'){
  await page.evaluate(async({data,pose})=>{
    window.smashSockets={};window.smashPose=pose;window.smashFrames=[];
    const canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#23364a';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#6fa18e';ctx.fillRect(0,canvas.height*.7,canvas.width,canvas.height*.3);
    const jpeg=canvas.toDataURL('image/jpeg');
    for(const c of ['C0','C1','C2']){
      const u=new URL('/ws/test/multi3d',location.href);u.protocol='ws:';u.search=new URLSearchParams({role:'phone',camera:c,key:'fragment-test',input_mode:'synthetic'});
      const ws=new WebSocket(u);window.smashSockets[c]=ws;
      ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='multi3d_clock_ping')ws.send(JSON.stringify({type:'multi3d_clock_pong',nonce:m.nonce,clock_id:c,device_time_ms:performance.now()}));
        else if(c==='C0'&&m.type==='multi3d_fused'){
          if(window.smashFrames.length<512)window.smashFrames.push({at:performance.now(),inputAt:m.input_reference_ms,cameras:m.cameras_used,
            right:m.joints?.right_wrist,fusionReason:m.reasons?.right_wrist,readiness:m.model_test?.readiness,
            diagnostic:m.model_test?.diagnostics?.right_wrist,phase:m.model_test?.phase,score:m.model_test?.score});
        }
      };
      await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.send(JSON.stringify(data.calibs[c]));
    }
    let frame=0;
    window.smashLoop=setInterval(()=>{
      const input_at_ms=performance.now();frame++;
      for(const [c,ws] of Object.entries(window.smashSockets))if(ws.readyState===1){
        ws.send(JSON.stringify({type:'multi3d_frame',clock_id:c,input_at_ms,landmarks:data[window.smashPose][c],fps:20}));
        if(frame%3===0)ws.send(JSON.stringify({type:'multi3d_jpeg',data:jpeg}));
      }
    },50);
  },{data:fixture,pose});
}

test('contact explosion preview is local first, spreads into smoke without a title and never changes score',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?scene=it1&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest?.snapshot().ready)).toBe(true);
  await expect(page.locator('#superPanel')).toBeVisible();
  await page.locator('#playView').click();await expect(page.locator('body')).toHaveClass(/play-view/);
  const before=await page.evaluate(()=>window.buildingFragmentTest.snapshot().score);
  const clockStart=new Date('2026-11-21T00:00:00Z');
  await page.clock.install({time:clockStart});await page.clock.pauseAt(new Date(clockStart.getTime()+10000));
  await expect(page.locator('#smashMode option[value="super_smash"]')).toHaveText('연쇄 폭파');
  await page.locator('#effectPreview').click();
  await page.evaluate(()=>window.buildingFragmentTest.previewImpact([320,650]));await page.clock.runFor(32);
  const pixel=await page.locator('#screenImpact').evaluate(canvas=>{
    const ctx=canvas.getContext('2d'),x=Math.round(320*canvas.width/innerWidth),y=Math.round(650*canvas.height/innerHeight);
    return [ctx.getImageData(x,y,1,1).data[3],ctx.getImageData(canvas.width-3,3,1,1).data[3]];
  });expect(pixel[0]).toBeGreaterThan(230);expect(pixel[1]).toBe(0);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(before);
  await page.screenshot({path:'test-results/building-fragments/explosion-contact-start.png'});
  await page.clock.runFor(200);await page.screenshot({path:'test-results/building-fragments/explosion-fireball.png'});
  await page.clock.runFor(700);await page.screenshot({path:'test-results/building-fragments/explosion-collapse.png'});
  await page.clock.runFor(1300);await expect(page.locator('#screenImpact')).toBeHidden();
  await page.locator('#superMute').click();await page.locator('#reduceMotion').check();await page.locator('#effectPreview').click();
  await page.clock.runFor(100);expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().super.audio.muted)).toBe(true);
  expect(errors).toEqual([]);
});

test('super controls are available only in the triangulated three-camera version',async({page})=>{
  await page.goto('/test/building/?mode=mono&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest?.snapshot().ready)).toBe(true);
  await expect(page.locator('#superPanel')).toBeHidden();
});

test('three aligned phones: accepted strike clears all, reconnect is silent, restore and camera loss rearm safely',async({page},testInfo)=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.goto('/test/building/?scene=it1&key=fragment-test');await expect.poll(()=>page.evaluate(()=>{
    const s=window.buildingFragmentTest?.snapshot();return !!(s?.connected&&s.ready&&s.viewerId&&s.modelState?.server_instance_id);
  })).toBe(true);};
  await open();await page.locator('#claimControl').click();
  await expect.poll(()=>page.evaluate(()=>{const s=window.buildingFragmentTest.snapshot();return s.modelState.controller_viewer_id===s.viewerId&&!s.controlPending;})).toBe(true);
  // The hub is shared: a URL does not reset the scene left by earlier tests/operators.
  await page.locator('#superIt1').click();
  await expect.poll(()=>page.evaluate(()=>{const s=window.buildingFragmentTest.snapshot();return s.sceneId==='it1'&&s.ready&&!s.controlPending;})).toBe(true);
  await page.locator('#smashMode').selectOption('super_smash');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.smash_mode)).toBe('super_smash');
  await phones(page);await page.locator('#playView').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.phase),{timeout:20000}).toBe('armed');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.readiness.joints.includes('right_wrist')),{timeout:20000}).toBe(true);
  await page.evaluate(()=>{window.smashPose='after';});
  try{await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(96);}
  catch(error){writeFileSync(testInfo.outputPath('contact-failure-trace.json'),JSON.stringify(await page.evaluate(()=>window.smashFrames),null,2));throw error;}
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().super.eventCount)).toBe(1);
  const result=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(result.modelState.phase).toBe('cleared');expect(result.physics.dynamic).toBeLessThanOrEqual(128);
  expect(result.super.logs[0].input_mode).toBe('synthetic');
  await page.waitForTimeout(180);await page.screenshot({path:'test-results/building-fragments/explosion-live-synthetic.png'});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().super.logs[0].firstDraw)).not.toBeNull();
  const log=await page.evaluate(()=>window.buildingFragmentTest.snapshot().super.logs[0]);
  writeFileSync(testInfo.outputPath('contact-success-trace.json'),JSON.stringify(await page.evaluate(()=>window.smashFrames),null,2));
  const panel=result.cameraPanels.find(c=>c.id==='C0'),p=log.point_m,{R,t}=fixture.calibs.C0;
  const q=[0,1,2].map(r=>R[r*3]*p[0]+R[r*3+1]*p[1]+R[r*3+2]*p[2]+t[r]);
  const expected=[panel.x+(fixture.K.fx*q[0]/q[2]+fixture.K.cx)/fixture.width*panel.width,
    panel.y+(fixture.K.fy*q[1]/q[2]+fixture.K.cy)/fixture.height*panel.height];
  expect(log.originPx[0]).toBeCloseTo(expected[0],1);expect(log.originPx[1]).toBeCloseTo(expected[1],1);
  console.log('Super synthetic first draw',JSON.stringify({...log,receiveToDrawMs:log.firstDraw-log.received}));
  writeFileSync(testInfo.outputPath('synthetic-browser-metric.json'),JSON.stringify({...log,receiveToDrawMs:log.firstDraw-log.received,input:'synthetic',renderer:'d3d11',physicalLatency:'unmeasured'},null,2));
  await open();expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(96);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().super.eventCount)).toBe(0);
  await page.locator('#claimControl').click();await expect(page.locator('#superRestore')).toBeEnabled();await page.locator('#superRestore').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(0);
  await phones(page,'after');await page.waitForTimeout(800);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(0);
  await page.evaluate(()=>{window.smashPose='before';});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.phase),{timeout:20000}).toBe('armed');
  await page.evaluate(()=>window.smashSockets.C2.close());
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.readiness.reason)).toBe('three_cameras_required');
  await page.evaluate(()=>{window.smashPose='after';});await page.waitForTimeout(200);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().score)).toBe(0);
  await page.locator('#superStop').click();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.phase)).toBe('paused');
  await page.locator('#superStop').click();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.phase)).toBe('preparing');
  await page.locator('#smashMode').selectOption('normal');await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.smash_mode)).toBe('normal');
  await page.evaluate(()=>{clearInterval(window.smashLoop);Object.values(window.smashSockets).forEach(s=>s.close());});
  expect(errors).toEqual([]);
});
