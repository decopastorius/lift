import test from 'node:test';
import assert from 'node:assert/strict';
import { SET } from '../src/progression.js';
import {
  formatLog, parseLog, parseProgramPaste, parseColumnPaste, restSeconds, programRows, defaultLayout, nextWeek, weekOf,
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
  const done = (name, week, startedAt) => ({ id: name + week, status: 'done', name, week, startedAt });
  const ss = [done('Upper 1', 7, 1), done('Upper 2', 7, 3), done('Upper 1', 6, 0)];
  assert.equal(nextWeek('Upper 1', ss), 8);
  assert.equal(nextWeek('Lower 1', ss), 1);
  assert.equal(weekOf({ name: 'X', startedAt: 5, status: 'done', id: 'b' }, [{ id: 'a', name: 'X', status: 'done', startedAt: 1 }]), 2);
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
  const plan = planImport(PASTE, { locations, exercises, templates: [], sessions: [] }, { layout: defaultLayout(), lastDate: '2026-11-19' });
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.templates.length, 2);
  assert.equal(plan.exercises.length, 1, 'only "New Thing" is new');
  assert.equal(plan.exercises[0].repMin, 10);
  assert.equal(plan.sessions.length, 2);
  const [s1, s2] = plan.sessions;
  assert.equal(s1.locationId, locations[0].id, 'week 1 was at Home (h rows)');
  assert.equal(s1.endedAt - s1.startedAt, 40 * 60000);
  assert.equal(s2.syncState, 'synced');
  assert.equal(s2.week, 2);
  assert.equal(new Date(s2.startedAt).getDate(), 19, 'the last workout lands on lastDate');
  assert.equal(new Date(s1.startedAt).getDate(), 12, 'a week earlier');
  assert.equal(plan.layout[0].rows[0].name, 'Seated Row (cable)');
  assert.ok(plan.layout[0].example);

  const row = exercises.find((e) => e.name === 'Seated Row (cable)');
  const history = plan.sessions.map((s) => ({ date: s.startedAt, sets: s.exercises.find((e) => e.exerciseId === row.id).sets }));
  assert.equal(suggest(row, history.slice(0, 1)).action, 'increase', '2 sets above 10');

  // importing again adds nothing
  const again = planImport(PASTE, { locations, exercises: [...exercises, ...plan.exercises], templates: plan.templates, sessions: plan.sessions }, { layout: plan.layout, lastDate: '2026-11-19' });
  assert.equal(again.sessions.length, 0);
  assert.equal(again.templates[0].id, plan.templates[0].id);

  // and the export writes the same cell back
  const exById = Object.fromEntries([...exercises, ...plan.exercises].map((e) => [e.id, e]));
  const payload = buildPayload(s1, {
    exercisesById: exById, locationsById: Object.fromEntries(locations.map((l) => [l.id, l])),
    sessions: plan.sessions, templates: plan.templates, layout: plan.layout,
  });
  assert.equal(payload.program.workout, 'Upper A');
  assert.equal(payload.program.week, 1);
  assert.equal(payload.program.duration, "40'");
  assert.equal(payload.program.rows.find((r) => r.name === 'Seated Row (cable)').log, '150 x 11, 11 | RIR 1, 0');
  assert.equal(payload.program.rows.find((r) => r.name === 'Chest Supported DB Row').log, '');
});

// One week's column, values only, as copied from the sheet (made-up numbers, real layout shape):
// Upper 1 starts at its first filled row; "Week N" marks the next blocks' headers.
const COLUMN = [
  '100 x 11, 11 | RIR 1, 0', '', '120 x 9, 9 | RIR 1, 0', '', '30 x 15, 16 | RIR 1, 1', '', '80 x 14, 13 | RIR 0, 0', '25 x 15, 14 | RIR 1, 0', '',
  'Week 7',
  '90 x 10, 10 | RIR 2, 2', '', '', '200 x 8, 8 | RIR 2, 2', '45 x 12, 11 | RIR 1, 0', '120 x 15, 15 | RIR 1, 0', 'BW x 15, 15 | RIR 5, 5', '',
  'Week 7',
  '100 x 10, 9 | RIR 1, 0', '', '250 x 10, 10 | RIR 0, 0', '', '30 x 15, 18 | RIR 0, 0', '', '80 x 13, 14 | RIR 0, 0', '', '25 x 15, 14 | RIR 1, 0',
].join('\n');

test('a single week column lines up with the program rows using the h/c tags', () => {
  const { blocks, warnings } = parseColumnPaste(COLUMN, defaultLayout());
  assert.deepEqual(warnings, []);
  assert.deepEqual(blocks.map((b) => [b.workout, b.week]), [['Upper 1', 7], ['Lower 1', 7], ['Upper 2', 7]]);
  assert.deepEqual(blocks[0].values, {
    'Seated Row (cable)': '100 x 11, 11 | RIR 1, 0',
    'Barbell Bench Press (horizontal)': '120 x 9, 9 | RIR 1, 0',
    'Lateral (cable)': '30 x 15, 16 | RIR 1, 1',
    'Cable Pressdown (rope)': '80 x 14, 13 | RIR 0, 0',
    'Standing Curl (DB / bilateral or unilateral)': '25 x 15, 14 | RIR 1, 0',
  });
  assert.deepEqual(Object.keys(blocks[1].values), [
    'Split Squat (Smith Machine)', 'Deadlift (conventional)', 'Seated Leg Curl (machine)', 'Leg Extension', 'Ab Exercise of Choice']);
  assert.deepEqual(Object.keys(blocks[2].values), [
    'Incline Barbell Press (15-30°)', 'Cable Pull-Downs (neutral grip)', 'Lateral (cable)', 'Cable Pressdown (rope)',
    'Standing Curl (DB / bilateral or unilateral)']);
});

test('importing a week column: history at Home, dated back from the last workout, next week follows', () => {
  const locations = seedLocations();
  const exercises = seedExercises();
  const plan = planImport(COLUMN, { locations, exercises, templates: [], sessions: [] }, { layout: defaultLayout(), lastDate: '2026-11-19' });
  assert.equal(plan.mode, 'column');
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.sessions.length, 3);
  assert.ok(plan.sessions.every((s) => s.locationId === locations[0].id && s.week === 7));
  assert.deepEqual(plan.sessions.map((s) => new Date(s.startedAt).getDate()), [15, 17, 19]);
  assert.equal(nextWeek('Upper 1', plan.sessions), 8);
  const ab = plan.sessions[1].exercises.at(-1);
  assert.equal(formatLog(ab.sets, true), 'BW x 15, 15 | RIR 5, 5');

  // the layout keeps the sheet's row order for the export
  const rows = programRows({
    workout: 'Upper 1', templates: seedTemplates(locations, exercises), locations,
    exercisesById: Object.fromEntries(exercises.map((e) => [e.id, e])), layout: defaultLayout(),
  });
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.tag, r.name]), [['c', 'Chest Supported DB Row'], ['h', 'Seated Row (cable)']]);
  assert.equal(rows.length, 9);
});

test('a column without a "Week N" line asks for the week', () => {
  const plan = planImport('BW x 15, 15', { locations: seedLocations(), exercises: seedExercises(), templates: [], sessions: [] },
    { layout: [{ name: 'Core', rows: [{ tag: 'hc', name: 'Ab Exercise of Choice' }] }], lastDate: '2026-11-19' });
  assert.equal(plan.missingWeek, true);
  assert.equal(plan.sessions.length, 0);
  const plan2 = planImport('BW x 15, 15', { locations: seedLocations(), exercises: seedExercises(), templates: [], sessions: [] },
    { layout: [{ name: 'Core', rows: [{ tag: 'hc', name: 'Ab Exercise of Choice' }] }], lastDate: '2026-11-19', week: 3 });
  assert.equal(plan2.sessions[0].week, 3);
});
