import { test, expect } from '@playwright/test';

const models = [
  ['knu-global-practice-v1', '글로벌플라자', 64],
  ['knu-main-v2', '경북대학교 본관', 85],
  ['knu-it5-practice-v1', 'IT5호관', 64],
  ['knu-it1-v3', 'IT1호관', 96],
  ['knu-library-practice-v1', '중앙도서관', 64],
];
const state = page => page.evaluate(() => window.__fractureDemo?.snapshot());
const ready = (id, count) => ({ buildingId:id, view:'building', loading:false, errorMessage:null,
  phase:'ready', score:0, fragmentCount:0, bodyCount:2, colliderCount:count+1,
  intactVisible:true, shardsVisible:false, restTransformsMatch:true });

test('each featured building can be fractured and restored in isolation', async ({page}, info) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/monitor/fracture/');
  const picker=page.getByLabel('연습할 건물', {exact:true});
  await expect(picker).toBeEnabled();
  await expect(picker.locator('optgroup[label="단독 파괴 연습"] option')).toHaveText(models.map(model=>model[1]));
  await expect(picker.locator('optgroup[label="다른 건물·이전 버전"] option')).not.toHaveCount(0);
  for (const [id,,count] of models) {
    await picker.selectOption(id);
    await expect.poll(()=>state(page)).toMatchObject(ready(id,count));
    await page.locator('#scene').focus();
    await page.keyboard.press('Space');
    await expect.poll(()=>state(page)).toMatchObject({ buildingId:id, phase:'playing', score:100,
      fragmentCount:count, bodyCount:count+1, colliderCount:count+1, seenEvents:1,
      intactVisible:false, shardsVisible:true, finiteBodies:true });
    await page.keyboard.press('Space');
    expect(await state(page)).toMatchObject({ score:100, seenEvents:1 });
    await page.keyboard.press('KeyR');
    await expect.poll(()=>state(page)).toMatchObject(ready(id,count));
    await page.screenshot({path:info.outputPath(`${id}-ready.png`),fullPage:true});
  }
  await page.locator('#scene').focus();
  await page.keyboard.press('Space');
  await expect.poll(()=>state(page)).toMatchObject({ destroyed:true, fragmentCount:64 });
  await picker.selectOption(models[0][0]);
  await expect.poll(()=>state(page)).toMatchObject(ready(models[0][0],64));
  expect(errors).toEqual([]);
});

test('a practice model opens directly and can be operated on mobile', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/monitor/fracture/?building=knu-it5-practice-v1');
  await expect.poll(()=>state(page)).toMatchObject(ready('knu-it5-practice-v1',64));
  await expect(page.getByLabel('연습할 건물',{exact:true})).toHaveValue('knu-it5-practice-v1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#destroy').click();
  await expect.poll(()=>state(page)).toMatchObject({ score:100, fragmentCount:64 });
  await page.locator('#reset').click();
  await expect.poll(()=>state(page)).toMatchObject(ready('knu-it5-practice-v1',64));
});
