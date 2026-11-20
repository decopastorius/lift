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

// The coach's real layout: tag in B, name in C, Week 1-7 in I-O, and a deload table in P-U
// whose rows don't line up with the main table.
const row = (...cells) => cells;
const blockTab = () => new Sheet('Block 2', [
  row('Instructions', '', 'Upper 1', 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Deload', 'Upper 1', 'Sets', 'Reps', 'Reps In Reserve', 'Week 8'),
  row('', '', 'Example for Logging Data >>>', '2', '8-10', '1-2', 'Double', '3-4', 'Load x rep/set - 100 x 8, 8', '', '', '', '', '', '', '', 'Example for Logging Data >>>', '2', '8-10', '3', '100 x 8, 8'),
  row('', 'c', 'Chest Supported DB Row', '2', '8-10', '0-1', 'Double', '3-4', '', '', '', '', '', '', '', 'h', 'Seated Row (cable)', '2', '8-10', '3', ''),
  row('', 'h', 'Seated Row (cable)', '2', '8-10', '0-1', 'Double', '3-4', '165 x 12, 12 | RIR 1, 0', '', '', '', '', '', '', 'h', 'Barbell Bench Press (horizontal)', '2', '8-10', '3', ''),
  row('', 'h', 'Barbell Bench Press (horizontal)', '2', '8-10', '1-2', 'Double', '3-4', '125 x 10, 9', '', '', '', '', '', '', '', '', '', '', '', ''),
  row('', '', '', '', '', '', '', '', "42'"),
  row('', '', 'Lower 1', 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', '', 'Lower 1', 'Sets', 'Reps', 'Reps In Reserve', 'Week 8'),
  row('', 'h', 'Leg Extension', '2', '10-15', '1-2', 'Double', '1-3', '130 x 14, 14', '', '', '', '', '', '', 'h', 'Leg Extension', '2', '10-15', '3', ''),
]);
const ROWS = [
  { tag: 'c', name: 'Chest Supported DB Row', sets: 2, reps: '8-10', rir: '0-1', progression: 'Double', rest: '3-4', log: '' },
  { tag: 'h', name: 'Seated Row (cable)', sets: 2, reps: '8-10', rir: '0-1', progression: 'Double', rest: '3-4', log: '' },
  { tag: 'h', name: 'Barbell Bench Press (horizontal)', sets: 2, reps: '8-10', rir: '1-2', progression: 'Double', rest: '3-4', log: '' },
  { tag: 'h', name: 'Cable Pressdown (rope)', sets: 2, reps: '10-15', rir: '0-1', progression: 'Double', rest: '1-3', log: '' },
];
const program = (week, logs, extra = {}) => ({
  workout: 'Upper 1', week, cycle: 2, duration: "45'",
  rows: ROWS.map((r) => ({ ...r, log: logs[r.name] || '' })), ...extra,
});
const payload = (id, p) => ({ sessionId: id, setHeaders: ['Session ID'], sets: [[id]], summaryHeaders: ['Session ID'], summary: [[id]], program: p });
const at = (sh, a1) => { const [, col, r] = a1.match(/^([A-Z])(\d+)$/); return sh.v[r - 1]?.[col.charCodeAt(0) - 65] ?? ''; };

test('weeks 1-7 go into the main table of the block tab, next to what is there', () => {
  const tab = blockTab();
  const { ss, post } = load([tab]);
  assert.deepEqual(post(payload('s2', program(2, { 'Seated Row (cable)': '170 x 10, 9 | RIR 1, 0' }, { note: 'Poor sleep',
    rows: ROWS.map((r) => (r.name === 'Seated Row (cable)' ? { ...r, log: '170 x 10, 9 | RIR 1, 0', note: 'Felt heavy' } : r)) }))),
  { ok: true, sheet: 'Coach Log' });
  assert.equal(at(tab, 'J4'), '170 x 10, 9 | RIR 1, 0');
  assert.equal(at(tab, 'I4'), '165 x 12, 12 | RIR 1, 0', 'week 1 untouched');
  assert.equal(at(tab, 'J6'), "45'", 'session time under the table');
  assert.equal(tab.notes['4,10'], 'Felt heavy\nlift-log:s2');
  assert.equal(tab.notes['6,10'], 'Poor sleep\nlift-log:s2');
  assert.equal(ss.getSheetByName('Program'), null);

  // re-sending replaces, doesn't duplicate
  post(payload('s2', program(2, { 'Seated Row (cable)': '170 x 10, 10 | RIR 1, 0' })));
  assert.equal(at(tab, 'J4'), '170 x 10, 10 | RIR 1, 0');
});

test('week 8 (deload) goes into the deload table, matched by name in its own rows', () => {
  const tab = blockTab();
  const { post } = load([tab]);
  post(payload('d', program(8, { 'Seated Row (cable)': '180 x 8, 8 | RIR 3, 3', 'Barbell Bench Press (horizontal)': '130 x 7, 7 | RIR 3, 3' })));
  assert.equal(at(tab, 'U3'), '180 x 8, 8 | RIR 3, 3');
  assert.equal(at(tab, 'U4'), '130 x 7, 7 | RIR 3, 3');
  assert.equal(at(tab, 'I4'), '165 x 12, 12 | RIR 1, 0', 'main table untouched');
});

test('a missing exercise is inserted inside its table only; the table beside it does not move', () => {
  const tab = blockTab();
  const { post } = load([tab]);
  post(payload('d', program(8, { 'Cable Pressdown (rope)': '90 x 12, 12 | RIR 3, 3' })));
  // deload table had Seated Row (row 3) and Bench (row 4); Pressdown goes in row 5 of P-U
  assert.equal(at(tab, 'Q5'), 'Cable Pressdown (rope)');
  assert.equal(at(tab, 'P5'), 'h');
  assert.equal(at(tab, 'S5'), '10-15');
  assert.equal(at(tab, 'U5'), '90 x 12, 12 | RIR 3, 3');
  assert.equal(at(tab, 'C5'), 'Barbell Bench Press (horizontal)', 'main table rows stay put');
  assert.equal(at(tab, 'Q8'), 'Lower 1', 'the next deload header moved down inside P-U only');
  assert.equal(at(tab, 'U9'), '', 'and its rows with it');
  assert.equal(at(tab, 'Q9'), 'Leg Extension');
  assert.equal(at(tab, 'C7'), 'Lower 1');
});

test('the next block is copied from the template tab', () => {
  const tpl = blockTab();
  tpl.name = 'example new block';
  const { ss, post } = load([new Sheet('Block 2', []), tpl]);
  post(payload('n', program(1, { 'Seated Row (cable)': '185 x 9, 9' }, { cycle: 3 })));
  const b3 = ss.getSheetByName('Block 3');
  assert.ok(b3, 'Block 3 created');
  assert.equal(at(b3, 'I4'), '185 x 9, 9', 'week cells of the copied template are cleared first');
  assert.equal(at(b3, 'I2'), 'Load x rep/set - 100 x 8, 8', 'example row kept');
  assert.equal(at(b3, 'I8'), '', 'other old entries cleared');
  assert.equal(ss.getSheetByName('example new block').v[3][8], '165 x 12, 12 | RIR 1, 0', 'template itself untouched');
});

test('no block tab and no template: a table is created', () => {
  const { ss, post } = load([]);
  post(payload('s1', program(1, { 'Seated Row (cable)': '165 x 12, 12 | RIR 1, 0' }, { cycle: 1 })));
  const sh = ss.getSheetByName('Block 1');
  assert.deepEqual(sh.v[0].slice(1, 8), ['Upper 1', 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1']);
  assert.deepEqual(sh.v[2].slice(0, 8), ['h', 'Seated Row (cable)', 2, '8-10', '0-1', 'Double', '3-4', '165 x 12, 12 | RIR 1, 0']);
  assert.ok(ss.getSheetByName('Summary') && ss.getSheetByName('Sets'));
});

test('deleting a workout removes its rows and its cells', () => {
  const tab = blockTab();
  const { ss, post } = load([tab]);
  post(payload('a', program(2, { 'Seated Row (cable)': '170 x 9, 9' })));
  post(payload('b', program(2, { 'Seated Row (cable)': '170 x 10, 10' }))); // same week: shares the cell
  assert.equal(at(tab, 'J4'), '170 x 9, 9\n170 x 10, 10');
  assert.equal(ss.getSheetByName('Summary').getLastRow(), 3);
  assert.deepEqual(post({ action: 'delete', sessionId: 'a', texts: ['170 x 9, 9', "45'"] }), { ok: true, cleared: 2 });
  assert.equal(at(tab, 'J4'), '170 x 10, 10');
  assert.equal(at(tab, 'J6'), "45'", 'session time still belongs to b');
  post({ action: 'delete', sessionId: 'b', texts: ['170 x 10, 10', "45'"] });
  assert.equal(at(tab, 'J4'), '');
  assert.equal(at(tab, 'J6'), '');
  assert.equal(ss.getSheetByName('Sets').getLastRow(), 1);
});

test('readProgram returns the Block tabs and the settings tab', () => {
  const settings = new Sheet('_Workout_Equipment_Settings', [['Key', 'Exercise', 'Location', 'Settings', 'Updated'], ['H|x', 'Leg Extension', 'H', 'Bench 5', '']]);
  const { post } = load([blockTab(), settings, new Sheet('Nutrition', [['long']])]);
  const r = post({ action: 'readProgram' });
  assert.deepEqual(Object.keys(r.tabs), ['Block 2']);
  assert.equal(r.tabs['Block 2'][3][2], 'Seated Row (cable)');
  assert.equal(r.settings[1][3], 'Bench 5');
});
