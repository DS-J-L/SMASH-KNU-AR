import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const catalog=JSON.parse(await fs.readFile(new URL('../../web/public/assets/buildings/catalog.json',import.meta.url),'utf8'));
const snap=page=>page.evaluate(()=>window.__fractureDemo.snapshot());
async function campus(page){
  await page.goto('/monitor/fracture/');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#campus-focus-wrap')).toBeHidden();
  await page.locator('#campus-view').click();
  await expect.poll(async()=>(await snap(page)).view,{timeout:30000}).toBe('campus');
  await expect(page.locator('#campus-focus')).toBeEnabled();
}
test('six reviewed buildings can be inspected at their real campus coordinates',async({page})=>{
  // Six campus camera moves plus three full-size SwiftShader screenshots can
  // exceed the ordinary single-scene budget on a busy desktop.
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await campus(page);
  for(const focus of catalog.campus_focus){
    await page.locator('#campus-focus').selectOption(focus.id);
    const state=await snap(page);expect(state.campusFocus).toBe(focus.id);
    state.cameraTarget.forEach((value,i)=>expect(value).toBeCloseTo(focus.target_y_up_m[i],6));expect(state.cameraPosition.every(Number.isFinite)).toBe(true);
    expect(state).toMatchObject({score:0,fragmentCount:0,bodyCount:2});
    await expect(page.locator('#view-label')).toContainText(focus.label);await expect(page.locator('#destroy')).toBeDisabled();
    if(['global','library','it2'].includes(focus.id)){
      await page.locator('canvas').focus();await page.waitForTimeout(300);
      await page.screenshot({path:`docs/asset-validation/map-review/demo-${focus.id}.png`});
    }
  }
  await page.locator('#campus-focus').selectOption('all');(await snap(page)).cameraTarget.forEach((value,i)=>expect(value).toBeCloseTo([0,-4,0][i],6));
  await page.locator('#building-view').click();await expect(page.locator('#campus-focus-wrap')).toBeHidden();
  await page.locator('canvas').focus();await page.keyboard.press('Space');expect((await snap(page)).score).toBe(100);
  expect(errors).toEqual([]);
});
test('campus focus controls fit the small screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});await campus(page);
  await page.locator('#campus-focus').selectOption('library');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await snap(page)).campusFocus).toBe('library');
  await page.screenshot({path:'docs/asset-validation/map-review/demo-mobile.png',fullPage:true});
});
