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
test('each district shows only its buildings and restores the full campus',async({page})=>{
  // Eight campus camera moves plus full-size SwiftShader screenshots can
  // exceed the ordinary single-scene budget on a busy desktop.
  test.setTimeout(120000);
  const errors=[],observations=[];page.on('pageerror',e=>errors.push(e.message));await campus(page);
  const allBuildings=catalog.campus_focus.flatMap(focus=>focus.building_ids).sort();
  expect(allBuildings).toHaveLength(123);
  expect(new Set(allBuildings).size).toBe(123);
  const initial=await snap(page);
  expect(initial.campusDistrict.buildingIds.sort()).toEqual(allBuildings);
  expect(initial.campusDistrict.groundClipPlanes).toBe(0);
  await expect(page.locator('#campus-focus option')).toHaveText([
    '전체 캠퍼스','① 북문·예술대·온실','② 본관·글로벌플라자·중앙도서관',
    '③ 농대·자연과학대','④ 체육관·대운동장','⑤ 박물관·사회과학대',
    '⑥ 공대·화학관','⑦ IT대·수의대','⑧ 생활관',
  ]);
  for(const focus of catalog.campus_focus){
    await page.locator('#campus-focus').selectOption(focus.id);
    const state=await snap(page);expect(state.campusFocus).toBe(focus.id);
    expect(state.campusDistrict.buildingIds.sort()).toEqual([...focus.building_ids].sort());
    expect(state.campusDistrict.groundClipPlanes).toBe(4);
    expect(state.cameraTarget.every(Number.isFinite)).toBe(true);
    expect(state.cameraPosition.every(Number.isFinite)).toBe(true);
    await expect(page.locator('#asset-detail')).toHaveText(`구역 건물 ${focus.building_ids.length}개`);
    expect(state).toMatchObject({score:0,fragmentCount:0,bodyCount:2});
    await expect(page.locator('#view-label')).toContainText(focus.label);await expect(page.locator('#destroy')).toBeDisabled();
    observations.push({id:focus.id,label:focus.label,state});
    await page.locator('#campus-focus').blur();await page.waitForTimeout(300);
    await page.screenshot({path:`docs/asset-validation/campus-zones/${focus.id}.png`,fullPage:true});
  }
  await page.locator('#campus-focus').selectOption('all');
  const restored=await snap(page);
  expect(restored.campusDistrict.buildingIds.sort()).toEqual(allBuildings);
  expect(restored.campusDistrict.groundClipPlanes).toBe(0);
  restored.cameraTarget.forEach((value,i)=>expect(value).toBeCloseTo([0,-4,0][i],6));
  await page.locator('#building-view').click();await expect(page.locator('#campus-focus-wrap')).toBeHidden();
  await page.locator('canvas').focus();await page.keyboard.press('Space');expect((await snap(page)).score).toBe(100);
  expect(errors).toEqual([]);
  await fs.writeFile('docs/asset-validation/campus-zones/desktop.json',JSON.stringify({input:'keyboard_demo',observations,pageErrors:errors,allCampusReturn:true,buildingReturnScore:100},null,2)+'\n');
});
test('campus district controls fit mobile and narrow tablet screens',async({page})=>{
  await page.setViewportSize({width:390,height:844});await campus(page);
  const observations=[];
  for(const viewport of [{width:390,height:844,name:'mobile'},{width:601,height:1000,name:'narrow-tablet'}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    for(const id of ['north-gate-arts','main-library']){
      await page.locator('#campus-focus').selectOption(id);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const state=await snap(page);expect(state.campusFocus).toBe(id);
      const district=catalog.campus_focus.find(focus=>focus.id===id);
      expect(state.campusDistrict.buildingIds.sort()).toEqual([...district.building_ids].sort());
      expect(state.campusDistrict.groundClipPlanes).toBe(4);
      observations.push({viewport,id,state});
    }
    await page.locator('#campus-focus').blur();
    await page.screenshot({path:`docs/asset-validation/campus-zones/${viewport.name}.png`,fullPage:true});
  }
  await fs.writeFile('docs/asset-validation/campus-zones/responsive.json',JSON.stringify({observations,horizontalOverflow:false},null,2)+'\n');
});
