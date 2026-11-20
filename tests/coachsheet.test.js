// Workbook import, on a made-up block in the coach's real layout (tag in B, name in C, weeks in I-O,
// deload table in P-U with its own rows, session time under the table, a week done at both places).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlockTab, parseSettingsTab } from '../src/coachsheet.js';
import { planWorkbookImport } from '../src/importer.js';
import { seedLocations, seedExercises, seedTemplates } from '../src/seed.js';
import { nextSlot } from '../src/program.js';
import { startSession, DEFAULT_SETTINGS } from '../src/session-logic.js';

const W = (n) => Array.from({ length: 7 }, (_, i) => (i < n.length ? n[i] : ''));
const header = (w) => ['', '', w, 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', w === 'Upper 1' ? 'Deload' : '', w, 'Sets', 'Reps', 'Reps In Reserve', 'Week 8'];
const ex = (tag, name, reps, rir, rest, weeks, deload = []) => ['', tag, name, '2', reps, rir, 'Double', rest, ...W(weeks), ...deload];
const block = (seated, curl) => [
  header('Upper 1'),
  ['', '', 'Example for Logging Data >>>', '2', '8-10', '1-2', 'Double', '3-4', 'Load x rep/set - 100 x 8, 8'],
  ex('c', 'Chest Supported DB Row', '8-10', '0-1', '3-4', ['', '', '60 x 10, 10 | RIR 1, 1'], ['h', 'Seated Row (cable)', '2', '8-10', '3', seated[7] || '']),
  ex('h', 'Seated Row (cable)', '8-10', '0-1', '3-4', seated, ['c', '', '', '', '', '']),
  ex('hc', 'Standing Curl (DB / bilateral or unilateral)', '10-15', '0-1', '1-3', curl, ['hc', 'Standing Curl (DB / bilateral or unilateral)', '2', '10-15', '3', curl[7] || '']),
  ['', '', '', '', '', '', '', '', "40'"],
];
const BOOK = {
  tabs: {
    'Block 1': block(['100 x 10, 10', '100 x 11, 11', '', '', '', '', '', '90 x 7, 7 | RIR 3, 3'], ['20 x 15, 15', '20 x 15, 15', '22.5 x 12, 12 | RIR 1, 0']),
    'Block 2': block(['110 x 9, 9 | RIR 1, 0', '110 x 11, 11 | RIR 1, 0'], ['25 x 15, 15 | RIR 1, 1', '25 x 15, 15 | RIR 0, 0']),
    Nutrition: [['ignored']],
  },
  settings: [['Key', 'Exercise', 'Location', 'Settings', 'Updated'], ['H|seated row (cable)', 'Seated Row (cable)', 'H', 'Seat 3, chest pad 5', ''], ['C|x', 'Chest Supported DB Row', 'C', '', '']],
};

test('parse a block tab: program, weeks, deload table, session time, mixed weeks', () => {
  const { workouts, logs } = parseBlockTab(BOOK.tabs['Block 1']);
  assert.equal(workouts.length, 1);
  assert.deepEqual(workouts[0].rows.map((r) => [r.tag, r.name, r.repMin, r.repMax, r.rir, r.rest]), [
    ['c', 'Chest Supported DB Row', 8, 10, '0-1', '3-4'],
    ['h', 'Seated Row (cable)', 8, 10, '0-1', '3-4'],
    ['hc', 'Standing Curl (DB / bilateral or unilateral)', 10, 15, '0-1', '1-3']]);
  const wk = (w) => logs.filter((l) => l.week === w);
  assert.equal(wk(1)[0].duration, 40);
  assert.deepEqual(Object.keys(wk(8)[0].values), ['Seated Row (cable)'], 'deload from its own table');
  // week 3: Chest Supported DB Row (c) and Curl (hc) only -> one cottage workout
  assert.deepEqual(wk(3).map((l) => Object.keys(l.values).length), [2]);
  assert.equal(parseSettingsTab(BOOK.settings).length, 1, 'rows without settings are skipped');
});

test('workbook import: blocks become cycles, program from the latest block, setups, next week follows', () => {
  const locations = seedLocations();
  const exercises = seedExercises();
  const old = { id: 'old', status: 'done', importKey: 'x', name: 'Upper 1', week: 7, startedAt: 1, exercises: [] };
  const plan = planWorkbookImport(BOOK, { locations, exercises, templates: seedTemplates(locations, exercises), sessions: [old] }, { lastDate: '2026-11-19' });
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.blocks.map((b) => [b.name, b.weeks]), [['Block 1', [1, 2, 3, 8]], ['Block 2', [1, 2, 3]]]);
  assert.deepEqual(plan.removeIds, ['old'], 'previously imported history is replaced');
  assert.equal(plan.setups, 1);
  const seated = plan.exercises.find((e) => e.name === 'Seated Row (cable)');
  assert.equal(seated.setups[locations[0].id].settings, 'Seat 3, chest pad 5');
  const last = plan.sessions.at(-1);
  assert.deepEqual([last.cycle, last.week, new Date(last.startedAt).getDate()], [2, 3, 19]);
  const b1w8 = plan.sessions.find((s) => s.cycle === 1 && s.week === 8);
  assert.equal(b1w8.deload, true);
  assert.equal(plan.sessions.find((s) => s.cycle === 1 && s.week === 3).locationId, locations[1].id, 'cottage week');
  assert.deepEqual(nextSlot('Upper 1', plan.sessions), { week: 4, cycle: 2, deload: false });

  // progression ignores the Block 1 deload and uses the latest real weeks
  const exById = Object.fromEntries([...exercises, ...plan.exercises].map((e) => [e.id, e]));
  const home = plan.templates.find((t) => t.name === 'Upper 1' && t.locationId === locations[0].id);
  const s = startSession({ template: home, exercisesById: exById, sessions: plan.sessions, settings: DEFAULT_SETTINGS });
  const row = s.exercises.find((e) => exById[e.exerciseId].name === 'Seated Row (cable)');
  assert.equal(row.suggestion.action, 'increase', '110 x 11, 11: two sets above 10');
  assert.equal(row.sets[0].weight, 115);
});
