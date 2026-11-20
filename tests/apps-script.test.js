// Runs apps-script/Code.gs against a small in-memory imitation of SpreadsheetApp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Sheet {
  constructor(name, rows = []) { this.name = name; this.v = rows.map((r) => [...r]); this.notes = {}; }
  getName() { return this.name; }
  getLastRow() { let n = this.v.length; while (n && !this.v[n - 1].some((x) => String(x ?? '').trim())) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.v.map((r) => { let n = r.length; while (n && !String(r[n - 1] ?? '').trim()) n--; return n; })); }
  cell(r, c) { while (this.v.length < r) this.v.push([]); const row = this.v[r - 1]; while (row.length < c) row.push(''); return row; }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const all = (fn) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(r + i, c + j, i, j); };
    return {
      getDisplayValues() { const out = []; for (let i = 0; i < nr; i++) { out.push([]); for (let j = 0; j < nc; j++) out[i].push(String(sh.v[r + i - 1]?.[c + j - 1] ?? '')); } return out; },
      getDisplayValue() { return String(sh.v[r - 1]?.[c - 1] ?? ''); },
      getValues() { return this.getDisplayValues(); },
      setValues(vals) { all((rr, cc, i, j) => { sh.cell(rr, cc)[cc - 1] = vals[i][j]; }); return this; },
      setValue(v) { sh.cell(r, c)[c - 1] = v; return this; },
      getNote() { return sh.notes[`${r},${c}`] || ''; },
      getNotes() { const out = []; for (let i = 0; i < nr; i++) { out.push([]); for (let j = 0; j < nc; j++) out[i].push(sh.notes[`${r + i},${c + j}`] || ''); } return out; },
      insertCells() {
        // shift this range's columns down by nr rows, from row r
        for (let cc = c; cc < c + nc; cc++) {
          const last = sh.v.length;
          for (let rr = last + nr; rr >= r + nr; rr--) {
            sh.cell(rr, cc)[cc - 1] = sh.v[rr - nr - 1]?.[cc - 1] ?? '';
            const from = sh.notes[`${rr - nr},${cc}`];
            if (from) sh.notes[`${rr},${cc}`] = from; else delete sh.notes[`${rr},${cc}`];
          }
          for (let rr = r; rr < r + nr; rr++) { sh.cell(rr, cc)[cc - 1] = ''; delete sh.notes[`${rr},${cc}`]; }
        }
        return this;
      },
      clearContent() { all((rr, cc) => { if (sh.v[rr - 1]) sh.v[rr - 1][cc - 1] = ''; }); return this; },
      setNote(n) { sh.notes[`${r},${c}`] = n; return this; },
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
    };
  }
  copyTo(ss) { const c = new Sheet(this.name + ' copy', this.v); c.notes = { ...this.notes }; ss.sheets.push(c); return c; }
  setName(n) { this.name = n; return this; }
  insertRowAfter(r) { this.v.splice(r, 0, []); const n = {}; for (const [k, val] of Object.entries(this.notes)) { const [rr, cc] = k.split(',').map(Number); n[`${rr > r ? rr + 1 : rr},${cc}`] = val; } this.notes = n; }
  appendRow(row) { this.v.splice(this.getLastRow(), 0, row); }
  setFrozenRows() {}
  setFrozenColumns() {}
  insertColumnAfter(col) {
    for (const r of this.v) { while (r.length < col) r.push(''); r.splice(col, 0, ''); }
    const n = {};
    for (const [k, val] of Object.entries(this.notes)) { const [rr, cc] = k.split(',').map(Number); n[`${rr},${cc > col ? cc + 1 : cc}`] = val; }
    this.notes = n;
  }
  deleteRows(r, n) { this.v.splice(r - 1, n); }
}

function load(sheets) {
  const ss = {
    sheets,
    getSheets: () => ss.sheets,
    getSheetByName: (n) => ss.sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); ss.sheets.push(s); return s; },
    getName: () => 'Coach Log',
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, Dimension: { ROWS: 'ROWS' } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: 'json' } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  const post = (body) => {
    const r = ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'change-me', ...body }) } });
    assert.equal(r.ok, true, `script replied: ${JSON.stringify(r)}`); // every call must succeed
    return r;
  };
  return { ss, post };
}

// The log tab: a row per exercise, "Week N" columns, repeated when needed.
const log = (week, rows, extra = {}) => ({ block: 2, week, workout: 'Upper 1', date: '2026-11-23', location: 'Home', rows, ...extra });
const payload = (id, l) => ({ sessionId: id, setHeaders: ['Session ID'], sets: [[id]], summaryHeaders: ['Session ID'], summary: [[id]], log: l });
const grid = (sh) => sh.v.map((r) => r.map((x) => x ?? ''));

test('first workout creates the block log tab: exercises as rows, the week on top', () => {
  const coach = new Sheet('Block 2', [['', '', 'Upper 1', 'Sets'], ['', 'h', 'Seated Row (cable)', '2']]);
  const { ss, post } = load([coach]);
  post(payload('a', log(8, [
    { name: 'Seated Row (cable)', log: '180 x 8, 8 | RIR 3, 3', note: 'Felt easy' },
    { name: 'Standing Curl (DB / bilateral or unilateral)', log: '35 x 12, 12 | RIR 3, 3' },
  ], { deload: true })));
  const sh = ss.getSheetByName('Block 2 log');
  assert.deepEqual(grid(sh), [
    ['Exercise', 'Week 8 (deload)'],
    ['Seated Row (cable)', '180 x 8, 8 | RIR 3, 3'],
    ['Standing Curl (DB / bilateral or unilateral)', '35 x 12, 12 | RIR 3, 3'],
  ]);
  assert.equal(sh.notes['2,2'], '2026-11-23 · Upper 1 · Home\nFelt easy\nlift-log:a');
  assert.deepEqual(coach.v, [['', '', 'Upper 1', 'Sets'], ['', 'h', 'Seated Row (cable)', '2']], "the coach's tab is not touched");
});

test('twice a week -> two Week columns; once a week fills only the first; order by week', () => {
  const { ss, post } = load([]);
  post(payload('u1', log(3, [{ name: 'Curl', log: '35 x 15, 14' }, { name: 'Row', log: '180 x 10, 9' }])));
  post(payload('l1', log(3, [{ name: 'Deadlift', log: '220 x 8, 8' }], { workout: 'Lower 1' })));
  post(payload('u1w4', log(4, [{ name: 'Curl', log: '35 x 15, 15' }])));
  post(payload('u2', log(3, [{ name: 'Curl', log: '35 x 16, 14' }], { workout: 'Upper 2', location: 'Cottage' }))); // 2nd curl in week 3
  const sh = ss.getSheetByName('Block 2 log');
  assert.deepEqual(grid(sh), [
    ['Exercise', 'Week 3', 'Week 3', 'Week 4'],
    ['Curl', '35 x 15, 14', '35 x 16, 14', '35 x 15, 15'],
    ['Row', '180 x 10, 9', '', ''],
    ['Deadlift', '220 x 8, 8', '', ''],
  ]);
  assert.match(sh.notes['2,3'], /Upper 2 · Cottage/);
  assert.equal(sh.notes['2,4'].split('\n').at(-1), 'lift-log:u1w4', 'notes moved with the inserted column');

  // re-sending a workout replaces its own cell, in place
  post(payload('u2', log(3, [{ name: 'Curl', log: '35 x 16, 15' }], { workout: 'Upper 2' })));
  assert.equal(sh.v[1][2], '35 x 16, 15');
  assert.equal(sh.v[0].length, 4, 'no extra column');

  // a third curl that week adds a third Week 3 column, still before Week 4
  post(payload('x', log(3, [{ name: 'Curl', log: '30 x 20, 20' }])));
  assert.deepEqual(sh.v[0], ['Exercise', 'Week 3', 'Week 3', 'Week 3', 'Week 4']);
  assert.equal(sh.v[1][3], '30 x 20, 20');

  // a new block gets its own tab
  post(payload('b3', log(1, [{ name: 'Row', log: '185 x 9, 8' }], { block: 3 })));
  assert.deepEqual(grid(ss.getSheetByName('Block 3 log')), [['Exercise', 'Week 1'], ['Row', '185 x 9, 8']]);
});

test('deleting a workout removes its Summary/Sets rows and clears its cells', () => {
  const { ss, post } = load([]);
  post(payload('a', log(1, [{ name: 'Row', log: '170 x 9, 9' }, { name: 'Curl', log: '30 x 15, 15' }])));
  post(payload('b', log(1, [{ name: 'Curl', log: '30 x 15, 14' }])));
  assert.equal(ss.getSheetByName('Summary').getLastRow(), 3);
  assert.deepEqual(post({ action: 'delete', sessionId: 'a', texts: ['170 x 9, 9', '30 x 15, 15'] }), { ok: true, cleared: 2 });
  const sh = ss.getSheetByName('Block 2 log');
  assert.equal(sh.v[1][1], '');
  assert.equal(sh.v[2][1], '');
  assert.equal(sh.v[2][2], '30 x 15, 14', "the other workout's entry stays");
  assert.equal(ss.getSheetByName('Sets').getLastRow(), 2);
});

test('readProgram returns the coach Block tabs (not the log tabs) and the settings tab', () => {
  const settings = new Sheet('_Workout_Equipment_Settings', [['Key', 'Exercise', 'Location', 'Settings', 'Updated'], ['H|x', 'Leg Extension', 'H', 'Bench 5', '']]);
  const { post } = load([new Sheet('Block 2', [['', '', 'Upper 1', 'Sets']]), new Sheet('Block 2 log', [['Exercise']]), settings, new Sheet('Nutrition', [['long']])]);
  const r = post({ action: 'readProgram' });
  assert.deepEqual(Object.keys(r.tabs), ['Block 2']);
  assert.equal(r.version, 5);
  assert.equal(r.settings[1][3], 'Bench 5');
});
