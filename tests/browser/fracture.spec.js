import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const count=JSON.parse(await readFile(new URL('../../web/public/assets/buildings/knu-it1-v3/manifest.json',import.meta.url),'utf8')).fragment_count;

const snapshot = page => page.evaluate(() => window.__fractureDemo.snapshot());
async function open(page) {
  await page.goto('/monitor/fracture/');
  await expect(page.getByRole('button',{name:'테스트 시작',exact:true})).toBeEnabled();
  await expect.poll(async () => (await snapshot(page)).loading).toBe(false);
}

test('real package: keyboard fracture, single score, floor contacts and repeated clean restoration', async ({page}) => {
  // Budget for 20 dense-model resets and three SwiftShader image captures.
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);
  expect(count).toBe(96);
  expect(await snapshot(page)).toMatchObject({buildingId:'knu-it1-v3',bodyCount:2,colliderCount:count+1,fragmentCount:0,score:0,restTransformsMatch:true});
  await page.screenshot({path:'docs/asset-validation/demo-ready.png'});
  await page.keyboard.press('Space');
  expect(await snapshot(page)).toMatchObject({phase:'playing',destroyed:true,score:100,fragmentCount:count,bodyCount:count+1,colliderCount:count+1,seenEvents:1,finiteBodies:true});
  await page.keyboard.press('Space');
  expect((await snapshot(page)).score).toBe(100);
  await page.waitForTimeout(180);
  await page.screenshot({path:'docs/asset-validation/demo-fractured.png'});
  await page.waitForTimeout(2000);
  const settled=await snapshot(page);expect(settled.finiteBodies).toBe(true);expect(settled.minFragmentY).toBeGreaterThan(-.06);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(100);
  const baseline=await snapshot(page);
  for(let i=0;i<20;i++) {
    await page.keyboard.press('Space');await page.keyboard.press('KeyR');
    expect(await snapshot(page)).toMatchObject({phase:'ready',destroyed:false,score:0,fragmentCount:0,bodyCount:2,colliderCount:count+1,seenEvents:0,restTransformsMatch:true,intactVisible:true,shardsVisible:false,dustVisible:false});
  }
  const end=await snapshot(page);expect(end.geometryCount).toBe(baseline.geometryCount);expect(end.textureCount).toBe(baseline.textureCount);
  await page.screenshot({path:'docs/asset-validation/demo-restored.png'});
  expect(errors).toEqual([]);
});

test('60-second end blocks hits, and reset restores a new ready session', async ({page}) => {
  await open(page);await page.clock.install();
  await page.getByRole('button',{name:'테스트 시작',exact:true}).click();
  await page.clock.fastForward(60500);
  await expect(page.getByRole('button',{name:/파괴 Space/})).toBeDisabled();
  await page.keyboard.press('Space');
  expect(await snapshot(page)).toMatchObject({phase:'ended',score:0,fragmentCount:0});
  await page.keyboard.press('KeyR');expect((await snapshot(page)).phase).toBe('ready');
});

test('campus terrain inspection returns to intact prop without extra bodies', async ({page}) => {
  await open(page);await page.getByRole('button',{name:'캠퍼스 지형',exact:true}).click();
  await expect.poll(async () => (await snapshot(page)).view,{timeout:30000}).toBe('campus');
  await expect(page.getByRole('button',{name:/파괴 Space/})).toBeDisabled();
  await page.screenshot({path:'docs/asset-validation/demo-campus.png'});
  await page.getByRole('button',{name:'건물 파괴',exact:true}).click();
  expect(await snapshot(page)).toMatchObject({view:'building',phase:'ready',bodyCount:2,score:0});
});

test('missing package remains disabled and explains recovery', async ({page}) => {
  await page.route('**/manifest.json', route=>route.fulfill({status:404,body:'missing'}));
  await page.goto('/monitor/fracture/');
  await expect(page.getByRole('status')).toContainText('준비 실패');
  await expect(page.getByRole('button',{name:'테스트 시작',exact:true})).toBeDisabled();
});

test('small viewport has usable controls and no horizontal overflow', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await open(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/asset-validation/demo-mobile.png',fullPage:true});
  await page.getByRole('button',{name:/파괴 Space/}).click();
  expect((await snapshot(page)).fragmentCount).toBe(count);
});
