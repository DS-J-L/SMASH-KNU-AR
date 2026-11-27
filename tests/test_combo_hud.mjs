import test from 'node:test';
import assert from 'node:assert/strict';
import {comboView,scoreText} from '../frontend/building-test/combo-hud.js';
const base={combo_count:3,max_combo:3,multiplier_tenths:12,combo_remaining_ms:4000,combo_pause_remaining_ms:1000,game_score_units:144,cleared_count:1};
test('score uses exact tenths and linear multiplier',()=>{
  assert.equal(scoreText(144),'14.4');assert.equal(scoreText(330),'33');
  assert.equal(comboView(base).score,'14.4');assert.equal(comboView(base).multiplier,'1.2');
});
test('first transition second freezes, second drains, expiry resets only the multiplier',()=>{
  assert.equal(comboView(base,500).remaining,4000);assert.equal(comboView(base,500).status,'콤보 잠시 정지');
  assert.equal(comboView(base,1000).remaining,4000);assert.equal(comboView(base,2000).remaining,3000);
  assert.equal(comboView(base,5000).count,3);assert.equal(comboView(base,5001).count,0);
  assert.equal(comboView(base,5001).multiplier,'1.0');assert.equal(comboView(base,5001).score,'14.4');
});
test('missing/empty snapshots and elapsed time before receipt stay bounded',()=>{
  assert.equal(comboView(null).score,'0');assert.equal(comboView(null).count,0);
  assert.equal(comboView(base,-100).remaining,4000);
  assert.equal(comboView({...base,awaiting_ready:true,combo_pause_remaining_ms:0},100).status,'다음 건물 준비 중');
});
