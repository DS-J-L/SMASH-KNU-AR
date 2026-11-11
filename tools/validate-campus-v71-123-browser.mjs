import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

const origin = process.argv[2] ?? 'http://127.0.0.1:8890';
const folder = 'docs/asset-validation/campus-v71-123';
const inventory = JSON.parse(await readFile(folder + '/inventory.json', 'utf8'));
const catalog = JSON.parse(await readFile('web/public/assets/buildings/catalog.json', 'utf8'));
assert.deepEqual(catalog.buildings.map(row => row.id), inventory.packages.map(row => row.id));

const native = process.env.AR_TEST_RENDERER === 'd3d11';
const browser = await chromium.launch({
  channel: process.env.AR_TEST_CHANNEL || undefined,
  args: ['--enable-webgl', '--disable-renderer-backgrounding', ...(native
    ? ['--use-angle=d3d11'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])],
});
const report = { input: 'keyboard_demo', browser: browser.version(), packages: [], pageErrors: [] };
const ready = row => ({
  buildingId: row.id, loading: false, phase: 'ready', score: 0, fragmentCount: 0,
  bodyCount: 2, colliderCount: row.fragment_count + 1, errorMessage: null,
  intactVisible: true, shardsVisible: false, restTransformsMatch: true,
});
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(origin + '/monitor/fracture/');
  return page;
}
const snapshot = page => page.evaluate(() => window.__fractureDemo?.snapshot());

try {
  const size = 12;
  for (let start = 0; start < inventory.packages.length; start += size) {
    const page = await open();
    const snap = () => snapshot(page);
    const picker = page.locator('#building-select');
    const canvas = page.locator('canvas#scene');
    await expect.poll(snap, { timeout: 30000 }).toMatchObject(ready(inventory.packages[0]));
    await expect(picker.locator('option')).toHaveCount(catalog.buildings.length);
    try {
      for (const row of inventory.packages.slice(start, start + size)) {
        report.current = row.id;
        await picker.selectOption(row.id);
        await expect.poll(snap, { timeout: 30000 }).toMatchObject(ready(row));
        await canvas.focus();
        await page.keyboard.press('Space');
        await expect.poll(snap).toMatchObject({
          buildingId: row.id, phase: 'playing', score: 100, fragmentCount: row.fragment_count,
          colliderCount: row.fragment_count + 1, bodyCount: row.fragment_count + 1,
          finiteBodies: true, errorMessage: null, intactVisible: false, shardsVisible: true,
        });
        await expect.poll(snap).toMatchObject({ restTransformsMatch: false });
        if (row.id === 'knu-osm-524021463-v71-g2-r1-fracture') {
          await page.screenshot({ path: folder + '/game-fragments.png' });
        }
        await page.keyboard.press('KeyR');
        await expect.poll(snap).toMatchObject(ready(row));
        await expect(page.locator('#time')).toHaveText('60s');
        report.packages.push({ id: row.id, fragments: row.fragment_count, selection: true, destruction: true, restoration: true });
      }
    } finally {
      await page.close();
    }
    console.log('Verified', report.packages.length, '/', inventory.packages.length);
  }
  const page = await open();
  const snap = () => snapshot(page);
  await expect.poll(snap, { timeout: 30000 }).toMatchObject(ready(inventory.packages[0]));
  report.current = 'campus';
  await page.setViewportSize({ width: 1440, height: 1060 });
  const requestedMap = page.waitForResponse(origin + catalog.campus, { timeout: 60000 });
  await page.locator('#campus-view').click({ force: true });
  assert.equal((await requestedMap).status(), 200);
  await expect.poll(snap, { timeout: 60000 }).toMatchObject({ view: 'campus', loading: false, errorMessage: null });
  await expect(page.locator('#ready-state')).toHaveText(catalog.campus_label);
  await expect(page.locator('#asset-detail')).toHaveText(catalog.campus_detail);
  const campus = await snap();
  assert.ok(campus.geometryCount > 1000);
  await page.screenshot({ path: folder + '/campus.png' });
  await page.locator('#building-view').click({ force: true });
  await expect.poll(snap).toMatchObject({ ...ready(inventory.packages[0]), view: 'building' });
  report.map = { path: catalog.campus, geometryCount: campus.geometryCount, label: catalog.campus_label, buildingReturn: true };
  delete report.current;
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.packages.length, inventory.packages.length);
  console.log('Verified campus map and building return.');
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await writeFile(folder + '/browser-qa.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
