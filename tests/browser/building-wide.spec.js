import {test,expect} from '@playwright/test';
// Wide stage (docs/WIDE_STAGE_TEST.md): three synthetic single-camera phones on markers ID0/ID1/ID2 in a row.
// Camera 2 m in front of its own marker, 1 m high, looking along +Y (x_cam = X, y_cam = -Z, z_cam = Y).
const calib=id=>({type:'mono3d_calib',marker_id:Number(id[1]),image:{width:640,height:360},K:{fx:420,fy:420,cx:320,cy:180},
  camera:{R:[1,0,0,0,0,-1,0,1,0],t:[0,1,2],C:[0,-2,1]},marker_side_m:.2});

test('wide stage: three videos side by side, markers in a row, the nearest phone judges and spacing rebuilds the zone',async({page})=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('/test/building/?mode=wide&key=fragment-test');
  await expect(page.locator('#sourceMode')).toContainText('넓은 무대');
  await expect(page.locator('#bodyReference')).toContainText('무대 세트 크기 · 몸 보정과 무관');
  await expect(page.locator('#sizePreview')).not.toContainText('허리');
  await expect(page.locator('#stageControl')).toBeVisible();await expect(page.locator('#placement')).toBeHidden();
  // Stage defaults (2026-11-20); auto-next is turned off here so the judged break stays on screen.
  await expect(page.locator('#autoNext')).toBeChecked();await page.locator('#autoNext').uncheck();
  // Stage sets (2026-11-20): one building each, 1.0~1.2 m tall (lower only when squeezing is not enough), same list as the API.
  const sets=await page.evaluate(async()=>(await (await fetch('/api/test/building-scenes?kind=stage&layout=wide&spacing=1.5')).json()).length);
  expect(sets).toBeGreaterThan(5);await expect(page.locator('#sceneSelect option')).toHaveCount(sets);
  await expect(page.locator('#sceneSelect option').first()).toContainText(/가로 [0-9.]+m · 높이 [01]\.[0-9]+m$/);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  let s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.sceneId).toMatch(/^wide:/);expect(s.markerX).toEqual([-1.5,0,1.5]);expect(s.stage.spacing_m).toBe(1.5);
  await expect(page.locator('#sceneInfo')).toContainText('마커 간격 1.5m');

  await page.evaluate(async calibs=>{
    window.widePhones={};
    for(const c of calibs){
      const id=`C${c.marker_id}`,u=new URL(`/ws/test/wide3d?role=phone&camera=${id}&key=fragment-test`,location.href);u.protocol='ws:';
      const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});window.widePhones[id]=ws;
      ws.send(JSON.stringify(c));
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');ctx.fillStyle=['#203040','#304020','#402030'][c.marker_id];ctx.fillRect(0,0,640,360);
      const packet=JSON.stringify({type:'mono3d_jpeg',data:canvas.toDataURL('image/jpeg')});ws.send(packet);
      setInterval(()=>{if(ws.readyState===1)ws.send(packet);},250);
    }
  },['C0','C1','C2'].map(calib));
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(3);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().cameraPanels.every(p=>p.visible))).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  // One row across the page: same top, left to right C0 | C1 | C2, each about a third of the width.
  const [c0,c1,c2]=s.cameraPanels;
  expect(Math.abs(c0.y-c1.y)).toBeLessThan(2);expect(Math.abs(c1.y-c2.y)).toBeLessThan(2);
  expect(c0.x).toBeLessThan(c1.x);expect(c1.x).toBeLessThan(c2.x);expect(c0.width).toBeGreaterThan(400);
  // The same stage point lands in the middle of C1's view and to the right/left in the side views.
  const centre=s.projection.find(p=>p.id==='C1').point,left=s.projection.find(p=>p.id==='C0').point,right=s.projection.find(p=>p.id==='C2').point;
  expect(left[0]).toBeGreaterThan(centre[0]);expect(right[0]).toBeLessThan(centre[0]);
  await expect(page.locator('#stageStatus')).toContainText('C2 · ID2 x=1.50m');

  // Only the hand strike is under test: falling debris would overwrite the last-event text.
  await page.locator('#impactBreak').uncheck();
  // The person stands at stage x 0.4 beside the building at x ~0.5: C1 judges. C0/C2 report the same swing and must not.
  const target=s.buildings.reduce((a,b)=>Math.abs(b.x-.5)<Math.abs(a.x-.5)?b:a);
  const lo=s.worldBounds.lo,hi=s.worldBounds.hi,z=Math.min(.2,target.height/2),bx=target.x;
  await page.evaluate(async({lo,hi,z,bx})=>{
    const send=(id,anchor,wrist)=>window.widePhones[id].send(JSON.stringify({type:'mono3d_frame',valid:true,anchor_m:[anchor,.3,0],
      joints:{left_hip:[anchor,.3,.9],right_hip:[anchor+.2,.3,.9],right_wrist:wrist}}));
    for(const y of [lo[1]-.5,lo[1]-.25,(lo[1]+hi[1])/2]){
      send('C0',1.9,[bx+1.5,y,z]);send('C2',-1.1,[bx-1.5,y,z]);send('C1',.4,[bx,y,z]);
      await new Promise(r=>setTimeout(r,60));
    }
  },{lo,hi,z,bx});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().removed.length),{timeout:10000}).toBeGreaterThan(0);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.owner).toBe('C1');expect(s.physics.finite).toBe(true);
  // The wide stage's default blast reach breaks the struck building, not the whole row.
  expect(s.removedBuildings.length).toBe(1);await expect(page.locator('#blastRadius')).toHaveValue('0.6');
  await expect(page.locator('#personStatus')).toContainText('C1 폰 근사');
  await expect(page.locator('#contact')).toContainText('오른손');
  await expect(page.locator('#stageStatus')).toContainText('C1 ★판정');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/building-fragments/wide-stage.png',fullPage:true});

  await page.locator('#stageSpacing').fill('2');await page.locator('#applySpacing').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId),{timeout:60000}).toContain(':2000:');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  s=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(s.markerX).toEqual([-2,0,2]);expect(s.removed).toEqual([]);
  await expect(page.locator('#stageStatus')).toContainText('C2 · ID2 x=2.00m');
  await page.locator('#stageSpacing').fill('1.5');await page.locator('#applySpacing').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().markerX)).toEqual([-1.5,0,1.5]);
  // C1 still judges but cannot see the right wrist; C2 sees the same person's wrist, so it is borrowed and shown.
  await page.evaluate(async()=>{
    const send=(id,anchor,wrist)=>window.widePhones[id].send(JSON.stringify({type:'mono3d_frame',valid:true,anchor_m:[anchor,.3,0],
      joints:{left_hip:[anchor,.3,.9],right_hip:[anchor+.2,.3,.9],...(wrist?{right_wrist:wrist}:{})}}));
    for(let i=0;i<3;i++){send('C2',-1.1,[-1.3,-2,.3]);send('C1',.4,null);await new Promise(r=>setTimeout(r,60));}
  });
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().borrowed)).toEqual({right_wrist:'C2'});
  await expect(page.locator('#status')).toContainText('오른손←C2');
  await page.evaluate(()=>Object.values(window.widePhones).forEach(ws=>ws.close()));
  expect(errors).toEqual([]);
});

test('wide stage phone page: camera number picks its own marker id and the wide link',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/mono3d/?stage=wide&camera=C2&key=fragment-test');
  await expect(page.locator('#wideCamera')).toBeVisible();
  await expect(page.locator('[data-wide-camera="C2"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#wideCameraInfo')).toContainText('ID2 마커');
  await expect(page.locator('#autoMarkerStatus')).toContainText('ID2');
  await expect(page.locator('#pcLinkHint a')).toHaveAttribute('href','/test/building/?mode=wide');
  await page.locator('[data-wide-camera="C0"]').click();
  await expect(page).toHaveURL(/camera=C0/);
  await expect(page.locator('#wideCameraInfo')).toContainText('ID0 마커');
  await page.goto('/test/mono3d/?key=fragment-test');
  await expect(page.locator('#wideCamera')).toBeHidden();
  expect(errors).toEqual([]);
});
