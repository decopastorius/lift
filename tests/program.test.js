import test from 'node:test';
import assert from 'node:assert/strict';
import { SET } from '../src/progression.js';
import {
  formatLog, parseLog, parseProgramPaste, restSeconds, weekNumber, programRows,
} from '../src/program.js';
import { seedLocations, seedExercises, seedTemplates } from '../src/seed.js';
import { planImport } from '../src/importer.js';
import { suggest } from '../src/progression.js';
import { buildPayload } from '../src/sheets.js';

const W = (weight, reps, rir) => ({ type: SET.WORKING, weight, reps, rir, done: true });

test('formatLog matches the coach format', () => {
  assert.equal(formatLog([W(165, 12, 1), W(165, 12, 0)]), '165 x 12, 12 | RIR 1, 0');
  assert.equal(formatLog([W(70, 20, 2), W(85, 12, 0)]), '70 x 20, 85 x 12 | RIR 2, 0');
  assert.equal(formatLog([W(0, 15, 5), W(0, 15, 5)], true), 'BW x 15, 15 | RIR 5, 5');
  assert.equal(formatLog([W(100, 8, null), W(100, 8, null)]), '100 x 8, 8');
  assert.equal(formatLog([
    { type: SET.WARMUP, weight: 20, reps: 10, done: true },
    W(30, 15, 1),
    { type: SET.MYO_ACT, weight: 20, reps: 15, done: true, block: 0 },
    { type: SET.MYO_MINI, weight: 20, reps: 5, done: true, block: 0 },
    { type: SET.PARTIAL, weight: 20, reps: 8, done: true },
  ]), '30 x 15 | RIR 1 | Myo 20 x 15+5 | Partials 20 x 8');
});

test('parseLog reads the coach format back', () => {
  const pick = (sets) => sets.map((s) => [s.type, s.weight, s.reps, s.rir]);
  assert.deepEqual(pick(parseLog('70 x 20, 85 x 12 | RIR 2, 0')), [
    [SET.WORKING, 70, 20, 2], [SET.WORKING, 85, 12, 0]]);
  assert.deepEqual(pick(parseLog('BW x 15, 15 | RIR 5, 5')), [
    [SET.WORKING, 0, 15, 5], [SET.WORKING, 0, 15, 5]]);
  assert.deepEqual(pick(parseLog('100 x 8, 8')), [[SET.WORKING, 100, 8, null], [SET.WORKING, 100, 8, null]]);
  const round = '30 x 15 | RIR 1 | Myo 20 x 15+5 | Partials 20 x 8';
  assert.equal(formatLog(parseLog(round)), round);
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog("42'"), []);
});

test('rest ranges and weeks', () => {
  assert.equal(restSeconds('3-4'), 180);
  assert.equal(restSeconds('1-3'), 60);
  assert.equal(restSeconds('2.5'), 150);
  assert.equal(restSeconds(''), null);
  assert.equal(weekNumber(new Date(2026, 10, 16, 9).getTime(), '2026-11-16'), 1);
  assert.equal(weekNumber(new Date(2026, 10, 22, 23).getTime(), '2026-11-16'), 1);
  assert.equal(weekNumber(new Date(2026, 10, 23, 1).getTime(), '2026-11-16'), 2);
});

test('seeded templates follow the h / c / hc tags', () => {
  const locs = seedLocations();
  const ex = seedExercises();
  const t = seedTemplates(locs, ex);
  const name = (id) => ex.find((e) => e.id === id).name;
  const home = (w) => t.find((x) => x.name === w && x.locationId === locs[0].id);
  const cottage = (w) => t.find((x) => x.name === w && x.locationId === locs[1].id);
  assert.equal(t.length, 6, 'Upper 1 / Lower 1 / Upper 2 x Home / Cottage (none for Travel)');
  assert.deepEqual(home('Upper 1').items.map((i) => name(i.exerciseId)), [
    'Seated Row (cable)', 'Barbell Bench Press (horizontal)', 'Lateral (cable)', 'Cable Pressdown (rope)',
    'Standing Curl (DB / bilateral or unilateral)']);
  assert.equal(cottage('Lower 1').items.length, 3);
  assert.equal(home('Upper 1').items[0].rest, 180);
  assert.equal(home('Upper 1').items[0].rir, '0-1');

  const rows = programRows({ workout: 'Upper 1', templates: t, locations: locs, exercisesById: Object.fromEntries(ex.map((e) => [e.id, e])) });
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.find((r) => r.name.startsWith('Standing Curl')).tag, 'hc');
  assert.deepEqual(rows.find((r) => r.name === 'Seated Row (cable)'), {
    exerciseId: rows.find((r) => r.name === 'Seated Row (cable)').exerciseId,
    name: 'Seated Row (cable)', sets: 2, reps: '8-10', rir: '0-1', progression: 'Double', rest: '3-4', tag: 'h',
  });
});

// A made-up block in the sheet's layout (tab-separated, as copied from Google Sheets).
const PASTE = [
  '\tUpper A\tSets\tReps\tReps In Reserve\tProgression\tRest Time (Min.)\tWeek 1\tWeek 2',
  '\tExample for Logging Data >>>\t2\t8-10\t1-2\tDouble \t3-4\tLoad x rep/set - 100 x 8, 8',
  'h\tSeated Row (cable)\t2\t8-10\t0-1\tDouble \t3-4\t150 x 11, 11 | RIR 1, 0\t155 x 9, 9 | RIR 1, 1',
  'c\tChest Supported DB Row\t2\t8-10\t0-1\tDouble \t3-4\t',
  'hc\tNew Thing\t2\t10-15\t0-1\tDouble \t1-3\tBW x 12, 12 | RIR 2, 2',
  "\t\t\t\t\t\t\t40'\t38'",
].join('\n');

test('parse a pasted sheet block', () => {
  const [w] = parseProgramPaste(PASTE);
  assert.equal(w.name, 'Upper A');
  assert.equal(w.rows.length, 3);
  assert.deepEqual(w.durations, { 1: 40, 2: 38 });
  assert.equal(w.rows[0].weeks[2], '155 x 9, 9 | RIR 1, 1');
  assert.equal(w.rows[2].tag, 'hc');
});

test('import creates templates, exercises and history; progression uses it', () => {
  const locations = seedLocations();
  const exercises = seedExercises();
  const plan = planImport(PASTE, { locations, exercises, templates: [], sessions: [] }, '2026-11-09');
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.templates.length, 2);
  assert.equal(plan.exercises.length, 1, 'only "New Thing" is new');
  assert.equal(plan.exercises[0].repMin, 10);
  assert.equal(plan.sessions.length, 2);
  const [s1, s2] = plan.sessions;
  assert.equal(s1.locationId, locations[0].id, 'week 1 was at Home (h rows)');
  assert.equal(s1.endedAt - s1.startedAt, 40 * 60000);
  assert.equal(s2.syncState, 'synced');
  assert.equal(weekNumber(s2.startedAt, '2026-11-09'), 2);

  const row = exercises.find((e) => e.name === 'Seated Row (cable)');
  const history = plan.sessions.map((s) => ({ date: s.startedAt, sets: s.exercises.find((e) => e.exerciseId === row.id).sets }));
  assert.equal(suggest(row, history.slice(0, 1)).action, 'increase', '2 sets above 10');

  // importing again adds nothing
  const again = planImport(PASTE, { locations, exercises: [...exercises, ...plan.exercises], templates: plan.templates, sessions: plan.sessions }, '2026-11-09');
  assert.equal(again.sessions.length, 0);
  assert.equal(again.templates[0].id, plan.templates[0].id);

  // and the export writes the same cell back
  const exById = Object.fromEntries([...exercises, ...plan.exercises].map((e) => [e.id, e]));
  const payload = buildPayload(s1, {
    exercisesById: exById, locationsById: Object.fromEntries(locations.map((l) => [l.id, l])),
    sessions: plan.sessions, templates: plan.templates, programStart: '2026-11-09',
  });
  assert.equal(payload.program.workout, 'Upper A');
  assert.equal(payload.program.week, 1);
  assert.equal(payload.program.duration, "40'");
  assert.equal(payload.program.rows.find((r) => r.name === 'Seated Row (cable)').log, '150 x 11, 11 | RIR 1, 0');
  assert.equal(payload.program.rows.find((r) => r.name === 'Chest Supported DB Row').log, '');
});
