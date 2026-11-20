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
      clearContent() { all((rr, cc) => { if (sh.v[rr - 1]) sh.v[rr - 1][cc - 1] = ''; }); return this; },
      setNote(n) { sh.notes[`${r},${c}`] = n; return this; },
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
    };
  }
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
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return JSON.parse(t); } }), MimeType: { JSON: 'json' } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'change-me', ...body }) } });
  return { ss, post };
}

const H = ['', 'Upper 1', 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1'];
const program = (week, log, extra = []) => ({
  workout: 'Upper 1', week, duration: "45'",
  rows: [
    { tag: 'c', name: 'Chest Supported DB Row', sets: 2, reps: '8-10', rir: '0-1', progression: 'Double', rest: '3-4', log: '' },
    { tag: 'h', name: 'Seated Row (cable)', sets: 2, reps: '8-10', rir: '0-1', progression: 'Double', rest: '3-4', log },
    ...extra,
  ],
});
const payload = (id, p) => ({ sessionId: id, setHeaders: ['Session ID'], sets: [[id]], summaryHeaders: ['Session ID'], summary: [[id]], program: p });

test('writes into the existing coach sheet, next to Week 1', () => {
  const coach = new Sheet('Sheet1', [
    H,
    ['', 'Example for Logging Data >>>', 2, '8-10', '1-2', 'Double', '3-4', 'Load x rep/set - 100 x 8, 8'],
    ['c', 'Chest Supported DB Row', 2, '8-10', '0-1', 'Double', '3-4', ''],
    ['h', 'Seated Row (cable)', 2, '8-10', '0-1', 'Double', '3-4', '165 x 12, 12 | RIR 1, 0'],
    ['', '', '', '', '', '', '', "42'"],
    [],
    ['', 'Lower 1', 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1'],
    ['h', 'Leg Extension', 2, '10-15', '1-2', 'Double', '1-3', '130 x 14, 14 | RIR 2, 2'],
  ]);
  const { ss, post } = load([coach]);
  assert.deepEqual(post(payload('s2', program(2, '170 x 9, 8 | RIR 1, 0'))), { ok: true, sheet: 'Coach Log' });
  assert.equal(coach.v[0][8], 'Week 2');
  assert.equal(coach.v[3][8], '170 x 9, 8 | RIR 1, 0');
  assert.equal(coach.v[3][7], '165 x 12, 12 | RIR 1, 0', 'week 1 untouched');
  assert.equal(coach.v[4][8], "45'");
  assert.equal(ss.getSheetByName('Program'), null, 'no new tab when the block exists');

  // notes for the coach land in the cell note
  post(payload('s2', { ...program(2, '170 x 9, 8 | RIR 1, 0'), note: 'Poor sleep',
    rows: program(2, '170 x 9, 8 | RIR 1, 0').rows.map((r) => (r.log ? { ...r, note: 'Felt heavy' } : r)) }));
  assert.equal(coach.notes['4,9'], 'Felt heavy\nlift-log:s2');
  assert.equal(coach.notes['5,9'], "Poor sleep\nlift-log:s2");
  assert.equal(coach.v[3][8], '170 x 9, 8 | RIR 1, 0');

  // re-sending the same workout replaces, doesn't duplicate
  post(payload('s2', program(2, '170 x 10, 9 | RIR 1, 0')));
  assert.equal(coach.v[3][8], '170 x 10, 9 | RIR 1, 0');

  // an exercise added mid-workout gets a new row inside the block, above the time row
  post(payload('s3', program(3, '170 x 10, 10', [{ tag: 'h', name: 'Face Pull', sets: 2, reps: '10-15', rir: '0-1', progression: 'Double', rest: '1-3', log: '40 x 15, 15' }])));
  assert.equal(coach.v[4][1], 'Face Pull');
  assert.equal(coach.v[4][9], '40 x 15, 15');
  assert.equal(coach.v[5][9], "45'");
  assert.equal(coach.v[7][1], 'Lower 1', 'next block shifted down, intact');
});

test('creates the block in a new Program tab when there is none', () => {
  const { ss, post } = load([]);
  post(payload('s1', program(1, '165 x 12, 12 | RIR 1, 0')));
  const sh = ss.getSheetByName('Program');
  assert.deepEqual(sh.v[0].slice(1, 8), ['Upper 1', 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1']);
  assert.deepEqual(sh.v[2].slice(0, 8), ['h', 'Seated Row (cable)', 2, '8-10', '0-1', 'Double', '3-4', '165 x 12, 12 | RIR 1, 0']);
  assert.equal(sh.v[3][7], "45'");
  assert.ok(ss.getSheetByName('Summary') && ss.getSheetByName('Sets'));
});

test('deleting a workout removes its rows and its cells', () => {
  const coach = new Sheet('Sheet1', [
    H,
    ['h', 'Seated Row (cable)', 2, '8-10', '0-1', 'Double', '3-4', ''],
    ['', '', '', '', '', '', '', ''],
  ]);
  const { ss, post } = load([coach]);
  post(payload('a', program(1, '165 x 12, 12')));
  post(payload('b', program(1, '170 x 9, 9'))); // same week: shares the cell
  assert.equal(coach.v[1][7], '165 x 12, 12\n170 x 9, 9');
  assert.equal(ss.getSheetByName('Summary').getLastRow(), 3);

  assert.deepEqual(post({ action: 'delete', sessionId: 'a', texts: ['165 x 12, 12', "45'"] }), { ok: true, cleared: 2 });
  assert.equal(coach.v[1][7], '170 x 9, 9');
  assert.equal(coach.notes['2,8'], 'lift-log:b');
  assert.equal(coach.v[2][7], "45'", 'session time still belongs to b');
  assert.equal(ss.getSheetByName('Summary').getLastRow(), 2);

  post({ action: 'delete', sessionId: 'b', texts: ['170 x 9, 9', "45'"] });
  assert.equal(coach.v[1][7], '');
  assert.equal(coach.v[2][7], '', 'session time cleared too');
  assert.equal(ss.getSheetByName('Sets').getLastRow(), 1);
});
