import test from 'node:test';
import assert from 'node:assert/strict';
import { SET } from '../src/progression.js';
import { weightOptions, repOptions, toggleNote, hasNote } from '../src/pickers.js';

test('weight options step around the suggestion', () => {
  assert.deepEqual(weightOptions({ suggested: 185, increment: 5 }), [165, 170, 175, 180, 185, 190, 195, 200, 205]);
  assert.deepEqual(weightOptions({ current: 5, increment: 2.5 }), [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  assert.deepEqual(weightOptions({ bodyweight: true, increment: 5 }), [0, 5, 10, 15, 20, 25, 30, 35, 40]);
  assert.deepEqual(weightOptions({ increment: 5 }), [80, 85, 90, 95, 100, 105, 110, 115, 120]);
  assert.deepEqual(weightOptions({ increment: 5, shift: 2 }), [170, 175, 180, 185, 190, 195, 200, 205, 210]);
  assert.deepEqual(weightOptions({ suggested: 185, increment: 5, shift: -1 }), [120, 125, 130, 135, 140, 145, 150, 155, 160]);
});

test('rep options cover the range with room either side', () => {
  assert.deepEqual(repOptions({ repMin: 8, repMax: 10 }), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(repOptions({ repMin: 10, repMax: 15, type: SET.MYO_MINI }), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('note presets toggle in and out of free text', () => {
  let v = 'left knee tight';
  v = toggleNote(v, 'Felt heavy');
  assert.equal(v, 'left knee tight; Felt heavy');
  assert.ok(hasNote(v, 'felt heavy'));
  v = toggleNote(v, 'Felt heavy');
  assert.equal(v, 'left knee tight');
});
