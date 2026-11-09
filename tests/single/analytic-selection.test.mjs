// Regression for the latest-main phone route boundary. No renderer, network or native physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { ANALYTIC_ID, requestedSinglePackage } from '../../frontend/game/package-selection.js';
const source = await fs.readFile(new URL('../../frontend/single/main.js', import.meta.url), 'utf8');
const line = source.split('\n').find(row => row.startsWith('async function init(){'));
assert.ok(line, 'current single init entrypoint must be present');
async function initialize(phoneInput, query) {
  const calls = { constructed: 0, loaded: 0, disposed: 0, errors: [], ready: false };
  const state = {
    phoneInput, ANALYTIC_ID, requestedSinglePackage, URL,
    location: { href: `http://127.0.0.1/monitor/${phoneInput ? 'phone-game' : 'single'}/?${query}` },
    view: null, disposed: false, sceneReady: false, message: null,
    $: () => ({}), resize() {}, gates() {}, frame() {}, requestAnimationFrame() {},
    console: { error: error => calls.errors.push(error.message) },
    FractureView: class {
      constructor(_element, { params }) { calls.constructed++; this.buildingId = requestedSinglePackage(params); }
      async load() { calls.loaded++; }
      dispose() { calls.disposed++; }
    },
  };
  await vm.runInNewContext(`${line}; init();`, state);
  return { state, calls };
}
for (const item of [
  { name: 'flagged analytic phone selection fails before construction', phone: true, query: `qa_compound=1&building=${ANALYTIC_ID}`, blocked: true },
  { name: 'unflagged phone keeps legacy selection', phone: true, query: 'room=room-2', blocked: false, id: 'knu-it1-v3' },
  { name: 'analytic ID without QA flag cannot promote phone package', phone: true, query: `building=${ANALYTIC_ID}`, blocked: false, id: 'knu-it1-v3' },
  { name: 'flagged standalone single can load analytic QA package', phone: false, query: `qa_compound=1&building=${ANALYTIC_ID}`, blocked: false, id: ANALYTIC_ID },
]) {
  test(item.name, async () => {
    const { state, calls } = await initialize(item.phone, item.query);
    assert.equal(calls.constructed, item.blocked ? 0 : 1);
    assert.equal(calls.loaded, item.blocked ? 0 : 1);
    assert.equal(state.sceneReady, !item.blocked);
    if (item.blocked) {
      assert.equal(state.view, null);
      assert.match(state.message, /analytic_qa_not_supported_for_phone_input/);
      assert.deepEqual(calls.errors, ['analytic_qa_not_supported_for_phone_input']);
    } else {
      assert.equal(state.view.buildingId, item.id);
      assert.equal(state.message, null);
      assert.deepEqual(calls.errors, []);
    }
  });
}
test('analytic single has candidate-only warning while preserving legacy readiness label', () => {
  assert.match(source, /view\?\.buildingId===ANALYTIC_ID\?'IT1 · 미승인 QA 후보':'IT1 · 준비됨'/);
  assert.match(source, /if\(view\?\.buildingId===ANALYTIC_ID\)\$\('scope'\)\.textContent='미승인 실험용 QA 후보입니다/);
});
