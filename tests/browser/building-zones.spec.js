import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const calib=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',"import sys,json;sys.path.insert(0,'tests');from test_multi3d_relay import calib;print(json.dumps(calib('C0')))"],{encoding:'utf8'}));
test('3 cameras: zones with two or three buildings, independent contacts, fixed size and zone switching',async({page})=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?key=fragment-test');
  await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await expect(page.locator('#sceneSelect option')).toHaveCount(23);
  await page.locator('#sceneSelect').selectOption('museum-social-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:60000}).toBe('museum-social-01');
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.buildingCount).toBe(2);expect(s.physics.bodies).toBe(s.visible.length+1);expect(s.fixedSize).toBe(true);expect(s.placement.scale).toBe(1);
  await expect(page.locator('#scale')).toBeDisabled();await expect(page.locator('#sizeRange')).toBeDisabled();await expect(page.locator('#applySize')).toBeDisabled();
  const originalBounds=s.worldBounds;
  const spec=await page.evaluate(async()=>fetch('/api/test/building-scenes/museum-social-01').then(r=>r.json()));
  expect(spec.render.every(b=>b.height_m>=.5)).toBe(true);
  await expect(page.locator('#sceneInfo')).toContainText('높이 0.5m 이상');
  expect(s.worldBounds.hi[2]).toBeCloseTo(spec.dimensions_m[1],3);
  await expect(page.locator('#status')).not.toContainText('구역 준비 중');
  await page.evaluate(async c=>{
    const u=new URL('/ws/test/multi3d?role=phone&camera=C0&key=fragment-test',location.href);u.protocol='ws:';
    const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.zonePhone=ws;
    ws.send(JSON.stringify(c));
    const canvas=document.createElement('canvas');canvas.width=c.image.width;canvas.height=c.image.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#17202d';ctx.fillRect(0,0,canvas.width,canvas.height);
    const packet=JSON.stringify({type:'multi3d_jpeg',data:canvas.toDataURL('image/jpeg')});ws.send(packet);
    window.zoneVideo=setInterval(()=>{if(ws.readyState===1)ws.send(packet);},250);
  },calib);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(1);
  await page.locator('#blastMode').uncheck();await page.locator('#collapse').uncheck();await page.locator('#impactBreak').uncheck();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().blastEnabled)).toBe(false);
  await page.locator('#orbit canvas').scrollIntoViewIfNeeded();
  const rect=await page.locator('#orbit canvas').boundingBox();
  const candidates=await page.evaluate(()=>window.buildingFragmentTest.pickPoints());
  const byBuilding=new Map();for(const p of candidates)if(!byBuilding.has(p.buildingId))byBuilding.set(p.buildingId,p);
  expect(byBuilding.size).toBeGreaterThanOrEqual(2);
  for(const p of [...byBuilding.values()].slice(0,2)){
    await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);
    await page.waitForTimeout(150);
  }
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().removedBuildings.length)).toBeGreaterThanOrEqual(2);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.removed.length).toBeGreaterThanOrEqual(2);expect(s.physics.finite).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/building-fragments/small-zone-two-buildings.png',fullPage:true});
  await page.locator('#sceneSelect').selectOption('dormitories-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:90000}).toBe('dormitories-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.buildingCount).toBe(3);expect(s.physics.bodies).toBe(s.visible.length+1);expect(s.placement.scale).toBe(1);
  await page.locator('#sceneSelect').selectOption('museum-social-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:60000}).toBe('museum-social-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready)).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.worldBounds.hi[2]).toBeCloseTo(originalBounds.hi[2],5);expect(s.removed).toHaveLength(0);expect(s.placement.scale).toBe(1);
  await page.locator('#sceneSelect').selectOption('north-gate-arts-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:120000}).toBe('north-gate-arts-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.buildingCount).toBe(3);expect(s.visible.length).toBeGreaterThan(96);expect(s.removed).toHaveLength(0);
  await page.evaluate(()=>{clearInterval(window.zoneVideo);window.zonePhone.close();});
  expect(errors).toEqual([]);
});

test('3 cameras: three-building zone loads at fixed size and releases its resources when switching zones',async({page})=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?key=fragment-test');await expect(page.locator('#dimensions')).toContainText('고정 높이');
  await page.locator('#sceneSelect').selectOption('north-gate-arts-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:120000}).toBe('north-gate-arts-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.steps),{timeout:30000}).toBeGreaterThan(120);
  const s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.buildingCount).toBe(3);expect(s.physics.bodies).toBe(s.visible.length+1);expect(s.physics.finite).toBe(true);expect(s.placement.scale).toBe(1);
  console.log('3-building static scene',JSON.stringify({fps:s.fps,frameCpuMs:s.frameCpuMs,bodies:s.physics.bodies}));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/building-fragments/small-zone-three-buildings.png',fullPage:true});
  await page.locator('#sceneSelect').selectOption('dormitories-01');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:60000}).toBe('dormitories-01');
  await expect.poll(()=>page.evaluate(()=>{const v=window.buildingFragmentTest.snapshot();return v.ready&&v.physics.bodies===v.visible.length+1;}),{timeout:60000}).toBe(true);
  expect(errors).toEqual([]);
});

test('default: 3 cameras start on a zone of several buildings, 1 camera starts on one building',async({page})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?key=fragment-test');
  await expect(page.locator('#sceneControl')).toBeVisible();await expect(page.locator('#autoNextControl')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:90000}).not.toBe('it1');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().buildingCount)).toBeGreaterThanOrEqual(2);
  await page.goto('/test/building/?mode=mono&key=fragment-test');
  await expect(page.locator('#sceneControl')).toBeVisible();await expect(page.locator('#autoNextControl')).toBeVisible();
  await expect(page.locator('#sceneSelect option')).toHaveCount(62);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.sceneId).toBe('it1');expect(s.buildingCount).toBe(1);
  // Choose another single building from the list.
  const second=await page.locator('#sceneSelect option').nth(1).getAttribute('value');
  await page.locator('#sceneSelect').selectOption(second);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:90000}).toBe(second);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.buildingCount).toBe(1);expect(s.fixedSize).toBe(true);
  await page.locator('#sceneSelect').selectOption('it1');    // the server keeps the stage between pages
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:90000}).toBe('it1');
  expect(errors).toEqual([]);
});

test('1 camera: a broken building is replaced by the next one after a few seconds when auto-next is on',async({page})=>{
  test.setTimeout(150000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?mode=mono&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  const ids=await page.locator('#sceneSelect option').evaluateAll(o=>o.map(x=>x.value));
  const start=await page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId);expect(ids).toContain(start);
  const next=ids[(ids.indexOf(start)+1)%ids.length];
  await page.locator('#autoNextDelay').fill('2');await page.locator('#autoNextDelay').dispatchEvent('change');
  // Off by default: breaking everything does not move on.
  await page.locator('#stress').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().removed.length)).toBeGreaterThan(50);
  await page.waitForTimeout(3500);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId)).toBe(start);
  // Turning it on while the building is already broken starts the countdown, then the next building appears intact.
  await page.locator('#autoNext').check();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().autoNextPending)).toBe(true);
  await expect(page.locator('#autoNextStatus')).toContainText('다음 건물');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:60000}).toBe(next);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());expect(s.removed).toHaveLength(0);expect(s.buildingCount).toBe(1);
  expect(s.autoNextPending).toBe(false);
  // A manual choice cancels a pending move.
  await page.locator('#stress').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().autoNextPending)).toBe(true);
  await page.locator('#sceneSelect').selectOption('it1');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:60000}).toBe('it1');
  await page.waitForTimeout(3500);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId)).toBe('it1');
  expect(errors).toEqual([]);
});
