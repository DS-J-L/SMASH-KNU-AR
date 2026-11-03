import { test, expect } from '@playwright/test';

const snapshot = page => page.evaluate(() => window.__fractureDemo.snapshot());
async function open(page) {
  await page.goto('/monitor/fracture/');
  await expect(page.getByRole('button', {name:'테스트 시작',exact:true})).toBeEnabled();
}

test('Space activates the focused start button without destroying the building', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name:'테스트 시작',exact:true}).press('Space');
  expect(await snapshot(page)).toMatchObject({phase:'playing',destroyed:false,score:0,fragmentCount:0});
});

test('Space on a focused view button opens the view without a hit', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name:'캠퍼스 지형',exact:true}).press('Space');
  expect((await snapshot(page)).score).toBe(0);
  await expect.poll(async () => (await snapshot(page)).view,{timeout:30000}).toBe('campus');
});

test('timer and end controls update on sparse frames away from a 200 ms boundary', async ({page}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__slowFrames = 0;
    window.requestAnimationFrame = callback => setTimeout(
      () => {window.__slowFrames++;callback(Math.floor(performance.now()/200)*200+100);},200);
  });
  await open(page);
  await page.getByRole('button', {name:'테스트 시작',exact:true}).click();
  await page.clock.runFor(2400);
  expect(await page.evaluate(()=>window.__slowFrames)).toBeGreaterThan(2);
  expect(Number.parseInt(await page.locator('#time').textContent())).toBeLessThan(60);
  await page.clock.fastForward(60500);
  await expect(page.getByRole('button',{name:/파괴 Space/})).toBeDisabled();
  await expect(page.locator('#time')).toHaveText('0s');
});

test('a late hit updates expiry even while animation frames are suspended', async ({page}) => {
  await page.clock.install();await open(page);
  await page.getByRole('button',{name:'테스트 시작',exact:true}).click();
  await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
  await page.clock.runFor(50);
  await page.clock.fastForward(60500);
  await page.locator('canvas').focus();await page.keyboard.press('Space');
  expect(await snapshot(page)).toMatchObject({phase:'ended',score:0,fragmentCount:0});
  await expect(page.locator('#time')).toHaveText('0s');
});

const invalidPackages = {
  'fragment-count': '파편 수와 충돌체 수가 다릅니다',
  'units': 'm 단위가 필요합니다',
  'rest-pivot': '피벗/복원 위치',
  'dimensions': '정상 모델 크기와 manifest가 다릅니다',
  'hull-bounds': '렌더 메시와 충돌체 크기',
};
for (const [variant,reason] of Object.entries(invalidPackages)) {
  test(`inconsistent package is rejected before enabling gameplay: ${variant}`, async ({page}) => {
    const file = ['units','dimensions'].includes(variant) ? 'manifest.json' : 'colliders.json';
    await page.route(`**/${file}`, async route => {
      const response = await route.fetch();const body = await response.json();
      if (variant === 'fragment-count') body.fragments.pop();
      if (variant === 'units') body.units = 'cm';
      if (variant === 'rest-pivot') body.fragments[0].rest_position_m[0] += 1;
      if (variant === 'dimensions') body.dimensions_m[0] /= body.scale_from_campus;
      if (variant === 'hull-bounds') body.fragments[0].vertices_m = body.fragments[0].vertices_m.map(v=>v*1.2);
      await route.fulfill({response,json:body});
    });
    await page.goto('/monitor/fracture/');
    await expect(page.getByRole('status')).toContainText('준비 실패',{timeout:10000});
    await expect(page.getByRole('status')).toContainText(reason);
    await expect(page.getByRole('button',{name:'테스트 시작',exact:true})).toBeDisabled();
    expect((await snapshot(page)).fragmentCount).toBe(0);
  });
}

test('failed campus load can be retried and clears the error', async ({page}) => {
  let requests=0;
  await page.route('**/knu-campus-v*.glb',async route => {
    requests++;
    if (requests===1) await route.fulfill({status:503,body:'try again'});
    else await route.continue();
  });
  await open(page);
  await page.getByRole('button',{name:'캠퍼스 지형',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('지형을 불러오지 못했습니다');
  await page.getByRole('button',{name:'캠퍼스 지형',exact:true}).click();
  await expect.poll(async () => (await snapshot(page)).view,{timeout:30000}).toBe('campus');
  expect((await snapshot(page)).errorMessage).toBeNull();
});
