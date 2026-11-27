import {test,expect} from '@playwright/test';
const calibration={type:'mono3d_calib',marker_id:1,image:{width:640,height:360},K:{fx:420,fy:420,cx:320,cy:180},
  camera:{R:[1,0,0,0,0,-1,0,1,0],t:[0,1,2],C:[0,-2,1]},marker_side_m:.27};
const view={type:'wide3d_view_calib',image:{width:1280,height:720},K:{fx:850,fy:850,cx:640,cy:360},
  camera:{R:[-1,0,0,0,0,-1,0,-1,0],t:[0,1.6,3.3],C:[0,3.3,1.6]},marker_ids:[0,1],spacing_m:2,marker_side_m:.27,reprojection_max_px:.8};

async function swing(page){
  await page.evaluate(async()=>{
    const s=window.buildingFragmentTest.snapshot(),{lo,hi}=s.worldBounds;
    const x=s.buildings[0].x-1,z=Math.min(.2,s.buildings[0].height/2);
    const send=y=>window.comboPhone.send(JSON.stringify({type:'mono3d_frame',valid:true,anchor_m:[0,.3,0],
      joints:{left_hip:[-.1,lo[1]-.6,.9],right_hip:[.1,lo[1]-.6,.9],right_wrist:[x,y,z]}}));
    for(const y of [lo[1]-.5,lo[1]-.25,(lo[1]+hi[1])/2]){send(y);await new Promise(r=>setTimeout(r,60));}
  });
}

test('PC combo HUD: body score, 80% transition, one-second freeze, two-second protection and retry',async({page})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/building/?mode=duo&key=fragment-test');
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  if(await page.locator('#duoSuper').isChecked())await page.locator('#duoSuper').uncheck();
  await page.locator('#restore').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.combo.game_score_units)).toBe(0);
  await page.evaluate(async({calibration,view})=>{
    const open=async url=>{const u=new URL(url,location.href);u.protocol='ws:';const ws=new WebSocket(u);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return ws;};
    window.comboPhone=await open('/ws/test/duo3d?role=phone&camera=C1&input_mode=synthetic&key=fragment-test');window.comboPhone.send(JSON.stringify(calibration));
    window.comboV=await open('/ws/test/duo3d?role=phone&camera=V&key=fragment-test');window.comboV.send(JSON.stringify(view));
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.fillStyle='#33404c';ctx.fillRect(0,0,1280,720);
    const image=JSON.stringify({type:'mono3d_jpeg',data:canvas.toDataURL('image/jpeg')});window.comboV.send(image);
    window.comboVideo=setInterval(()=>window.comboV.readyState===1&&window.comboV.send(image),200);
    window.comboControl=await open('/ws/test/duo3d?role=viewer&key=fragment-test');
  },{calibration,view});
  await expect(page.locator('#viewHud')).toBeVisible();await expect(page.locator('#comboHud')).toBeVisible();
  await swing(page);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.combo.game_score_units)).toBeGreaterThan(0);
  const first=await page.evaluate(()=>window.buildingFragmentTest.snapshot());
  expect(first.modelState.combo.combo_count).toBe(1);expect(first.blastEnabled).toBe(false);expect(first.collapse).toBe(false);
  await expect(page.locator('[data-count]')).toHaveText('1 HIT');await expect(page.locator('[data-multiplier]')).toHaveText('×1.0');
  const score=first.modelState.combo.game_score_units;
  // A controlled synthetic removal reaches the boundary; it must not invent extra weighted body points.
  await page.evaluate(()=>{
    const s=window.buildingFragmentTest.snapshot(),need=Math.ceil(s.modelState.fragment_count*.8);
    const ids=s.visible.filter(id=>!s.removed.includes(id)).slice(0,need-1-s.removed.length);
    for(let i=0;i<ids.length;i+=8)window.comboControl.send(JSON.stringify({type:'multi3d_model_release',ids:ids.slice(i,i+8)}));
  });
  await expect.poll(()=>page.evaluate(()=>{const s=window.buildingFragmentTest.snapshot();return s.removed.length===Math.ceil(s.modelState.fragment_count*.8)-1;})).toBe(true);
  expect(await page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId)).toBe(first.sceneId);
  await page.evaluate(()=>{const s=window.buildingFragmentTest.snapshot(),id=s.visible.find(id=>!s.removed.includes(id));window.comboControl.send(JSON.stringify({type:'multi3d_model_release',ids:[id]}));});
  await page.waitForFunction(()=>window.buildingFragmentTest.snapshot().modelState.combo.combo_paused,null,{timeout:15000,polling:20});
  let c=await page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.combo);
  expect(c.game_score_units).toBe(score);expect(c.cleared_count).toBe(1);
  await expect(page.locator('[data-status]')).toHaveText('콤보 잠시 정지');
  const frozen=await page.locator('[data-remaining]').textContent();await page.waitForTimeout(200);
  expect(await page.locator('[data-remaining]').textContent()).toBe(frozen);
  // With no further phone frames, the snapshot stays fixed; the real HUD must keep interpolating it.
  await expect(page.locator('[data-status]')).not.toHaveText('콤보 잠시 정지',{timeout:3000});
  await page.waitForTimeout(150);expect(parseFloat(await page.locator('[data-remaining]').textContent())).toBeLessThan(parseFloat(frozen));
  await page.waitForTimeout(1000); // The second protection second still blocks body damage.
  await swing(page);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.combo.game_score_units),{timeout:10000}).toBeGreaterThan(score);
  c=await page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.combo);
  expect(c.combo_count).toBe(2);expect(c.multiplier_tenths).toBe(11);
  await expect(page.locator('[data-multiplier]')).toHaveText('×1.1');
  await page.screenshot({path:'test-results/building-fragments/combo-normal.png',fullPage:true});
  await page.locator('#viewFullscreen').click();await expect(page.locator('#comboHud')).toBeVisible();await expect(page.locator('header')).toBeHidden();
  await page.screenshot({path:'test-results/building-fragments/combo-fullscreen.png'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:420,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#comboHud')).toBeVisible();
  await page.screenshot({path:'test-results/building-fragments/combo-narrow.png',fullPage:true});
  await page.locator('.combo-retry').click();
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().modelState.combo.game_score_units)).toBe(0);
  await expect(page.locator('[data-total]')).toHaveText('0');
  await page.evaluate(()=>{clearInterval(window.comboVideo);window.comboPhone.close();window.comboV.close();window.comboControl.close();});
  expect(errors).toEqual([]);
});
