import { test,expect } from '@playwright/test';
const snapshot=page=>page.evaluate(()=>window.__fractureDemo.snapshot());
async function open(page,id='knu-it1-v3'){
  await page.goto('/monitor/fracture/?building='+id);
  await expect(page.getByRole('button',{name:'테스트 시작',exact:true})).toBeEnabled();
  await expect.poll(async()=>(await snapshot(page)).buildingId).toBe(id);
}
async function select(page,id){
  await page.locator('#building-select').selectOption(id);
  await expect.poll(async()=>(await snapshot(page)).buildingId,{timeout:30000}).toBe(id);
  await expect.poll(async()=>(await snapshot(page)).loading).toBe(false);
}

test('new models and previous version can all fracture and restore',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await open(page);
  for(const id of ['knu-it1-v3','knu-main-v2','knu-it1-v2','knu-main-v1','knu-it1-v1']){
    await select(page,id);const count=(await snapshot(page)).expectedFragmentCount;
    expect(count).toBe({'knu-it1-v3':96,'knu-main-v2':85,'knu-it1-v2':64,'knu-main-v1':52,'knu-it1-v1':32}[id]);
    await page.locator('canvas').focus();await page.keyboard.press('Space');
    expect(await snapshot(page)).toMatchObject({score:100,fragmentCount:count,bodyCount:count+1,colliderCount:count+1,finiteBodies:true});
    await page.waitForTimeout(300);
    if(id==='knu-main-v2')await page.screenshot({path:'docs/asset-validation/fracture-refinement/demo-main-fractured.png'});
    await page.keyboard.press('KeyR');expect(await snapshot(page)).toMatchObject({bodyCount:2,fragmentCount:0,score:0,restTransformsMatch:true});
  }
  expect(errors).toEqual([]);
});

test('separated inspection blocks hits and restores from the range control',async({page})=>{
  await open(page);
  await page.locator('#separation').focus();await page.keyboard.press('End');
  expect(await snapshot(page)).toMatchObject({inspection:.4,bodyCount:2,score:0,intactVisible:false,shardsVisible:true});
  await expect(page.getByRole('button',{name:/파괴 Space/})).toBeDisabled();
  await page.locator('canvas').focus();await page.keyboard.press('Space');expect((await snapshot(page)).score).toBe(0);
  await page.screenshot({path:'docs/asset-validation/fracture-refinement/demo-it1-separated.png'});
  await page.locator('#separation').focus();await page.keyboard.press('KeyR');
  expect(await snapshot(page)).toMatchObject({inspection:0,restTransformsMatch:true,intactVisible:true,shardsVisible:false});
  await select(page,'knu-main-v2');await page.locator('#separation').focus();await page.keyboard.press('End');
  await page.screenshot({path:'docs/asset-validation/fracture-refinement/demo-main-separated.png'});
});

test('click selects a new impact point and dust clears on restoration',async({page})=>{
  await open(page);const original=(await snapshot(page)).impactPoint;
  const rect=await page.locator('canvas').boundingBox();
  await page.locator('canvas').click({position:{x:rect.width*.43,y:rect.height*.54}});
  const chosen=(await snapshot(page)).impactPoint;
  expect(chosen.some((v,i)=>Math.abs(v-original[i])>.01)).toBe(true);
  await page.keyboard.press('Space');expect((await snapshot(page)).dustVisible).toBe(true);
  await page.waitForTimeout(1400);expect((await snapshot(page)).dustVisible).toBe(false);
  await page.keyboard.press('KeyR');expect(await snapshot(page)).toMatchObject({score:0,dustVisible:false,fragmentCount:0});
});

test('switching warmed models releases previous GPU resources',async({page})=>{
  await open(page);
  const warm=async()=>{
    await page.locator('canvas').focus();await page.keyboard.press('Space');await page.waitForTimeout(150);await page.keyboard.press('KeyR');await page.waitForTimeout(100);
  };
  await warm();const baseline=await snapshot(page);
  for(let i=0;i<3;i++){
    await select(page,'knu-main-v2');await warm();await select(page,'knu-it1-v3');await warm();
  }
  const end=await snapshot(page);expect(end.bodyCount).toBe(2);expect(end.geometryCount).toBe(baseline.geometryCount);expect(end.textureCount).toBe(baseline.textureCount);
});

test('failed model replacement keeps the current package usable',async({page})=>{
  await open(page);
  await page.route('**/knu-main-v2/manifest.json',route=>route.fulfill({status:503,body:'missing'}));
  await page.locator('#building-select').selectOption('knu-main-v2');
  await expect(page.getByRole('status')).toContainText('기존 모델을 유지');
  expect(await snapshot(page)).toMatchObject({buildingId:'knu-it1-v3',bodyCount:2,loading:false});
  await page.locator('canvas').focus();await page.keyboard.press('Space');expect((await snapshot(page)).score).toBe(100);
});
