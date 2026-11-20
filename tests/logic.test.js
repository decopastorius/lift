import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, labelSets, SET } from '../src/progression.js';
import { myoNext, miniTarget } from '../src/myo.js';
import {
  startSession, logSet, unlogSet, finishSession, endMyoBlock, addSet, historyFor, DEFAULT_SETTINGS,
  startSet, endSet, cancelSet, nextPendingSet,
} from '../src/session-logic.js';
import { buildPayload, SET_HEADERS, SUMMARY_HEADERS } from '../src/sheets.js';

const ex = { id: 'bench', name: 'DB Bench', repMin: 8, repMax: 12, increment: 5 };
const w = (weight, ...reps) => reps.map((r) => ({ type: SET.WORKING, weight, reps: r, done: true }));
const h = (date, sets) => ({ date, sets });

test('no history -> start', () => {
  assert.equal(suggest(ex, []).action, 'start');
});

test('hold and add a rep when under the top', () => {
  const s = suggest(ex, [h(1, w(50, 10, 9, 8))]);
  assert.equal(s.action, 'hold');
  assert.equal(s.weight, 50);
  assert.deepEqual(s.targets, [11, 10, 9]);
});

test('top of range once is not enough', () => {
  const s = suggest(ex, [h(1, w(50, 12, 12, 12))]);
  assert.equal(s.action, 'hold');
});

test('top of range two sessions in a row at same load -> increase', () => {
  const s = suggest(ex, [h(1, w(50, 12, 12, 12)), h(2, w(50, 12, 12, 13))]);
  assert.equal(s.action, 'increase');
  assert.equal(s.weight, 55);
  assert.deepEqual(s.targets, [8, 8, 8]);
});

test('top twice but at different loads -> hold', () => {
  const s = suggest(ex, [h(1, w(45, 12, 12)), h(2, w(50, 12, 12))]);
  assert.equal(s.action, 'hold');
});

test('two sets above range in one session -> increase', () => {
  const s = suggest(ex, [h(1, w(50, 13, 13, 10))]);
  assert.equal(s.action, 'increase');
  assert.equal(s.weight, 55);
});

test('one set above range is not enough', () => {
  assert.equal(suggest(ex, [h(1, w(50, 14, 11, 10))]).action, 'hold');
});

test('RIR is ignored', () => {
  const sets = w(50, 13, 13).map((s) => ({ ...s, rir: 4 }));
  assert.equal(suggest(ex, [h(1, sets)]).action, 'increase');
});

test('warm-ups, partials and back-off sets do not count', () => {
  const sets = [
    { type: SET.WARMUP, weight: 20, reps: 15, done: true },
    ...w(50, 12, 12),
    { type: SET.WORKING, weight: 40, reps: 9, done: true },
    { type: SET.PARTIAL, weight: 40, reps: 20, done: true },
  ];
  const s = suggest(ex, [h(1, sets), h(2, sets)]);
  assert.equal(s.action, 'increase');
});

test('myo activation counts when no working sets', () => {
  const sets = [
    { type: SET.MYO_ACT, weight: 30, reps: 12, done: true },
    { type: SET.MYO_MINI, weight: 30, reps: 4, done: true },
  ];
  assert.equal(suggest(ex, [h(1, sets), h(2, sets)]).action, 'increase');
});

test('myo guidance', () => {
  assert.equal(miniTarget(15), 5);
  assert.equal(miniTarget(6), 3);
  const act = { type: SET.MYO_ACT, reps: 12, done: true, block: 0 };
  let n = myoNext([act]);
  assert.equal(n.phase, 'mini');
  assert.equal(n.target, 4);
  n = myoNext([act, { type: SET.MYO_MINI, reps: 4, done: true }, { type: SET.MYO_MINI, reps: 3, done: true }]);
  assert.equal(n.phase, 'done');
  assert.equal(n.total, '12+4+3');
});

test('labels', () => {
  const sets = [{ type: SET.WARMUP }, { type: SET.WORKING }, { type: SET.WORKING }, { type: SET.MYO_ACT }, { type: SET.MYO_MINI }, { type: SET.PARTIAL }];
  assert.deepEqual(labelSets(sets), ['W1', '1', '2', 'MA', 'M1', 'P1']);
});

test('full session flow: plan, log, myo, superset rest, finish, sheet rows', () => {
  const curl = { id: 'curl', name: 'Curl', repMin: 10, repMax: 15, increment: 5 };
  const pull = { id: 'pull', name: 'Pull-up', repMin: 6, repMax: 10, increment: 5, bodyweight: true };
  const exercisesById = { bench: ex, curl, pull };
  const template = {
    id: 't1', name: 'Upper A', locationId: 'home',
    items: [
      { id: 'i1', exerciseId: 'bench', warmups: 1, sets: 2, myo: 0, partials: 1, rest: 150, restCustom: true, group: 'A' },
      { id: 'i2', exerciseId: 'pull', warmups: 0, sets: 2, myo: 0, partials: 0, rest: 150, restCustom: true, group: 'A' },
      { id: 'i3', exerciseId: 'curl', warmups: 0, sets: 0, myo: 1, partials: 0, rest: 90, group: '' },
    ],
  };
  const prior = {
    id: 'old', status: 'done', startedAt: 100, locationId: 'cottage', name: 'Old',
    exercises: [{ id: 'x', exerciseId: 'bench', sets: w(50, 13, 13) }],
  };
  let s = startSession({ template, exercisesById, sessions: [prior], settings: DEFAULT_SETTINGS, now: 1000 });
  const [b, p, c] = s.exercises;
  // progression follows the exercise, not the location
  assert.equal(b.suggestion.action, 'increase');
  assert.equal(b.sets.find((x) => x.type === SET.WORKING).weight, 55);
  assert.equal(p.sets[0].weight, 0); // bodyweight default

  // warm-up
  b.sets[0].weight = 25; b.sets[0].reps = 10;
  s.exercises[0] = b;
  s = logSet(s, b.id, b.sets[0].id, { now: 2000 });
  assert.equal(s.restTarget, DEFAULT_SETTINGS.warmupRest);
  // working set 1 with target reps auto-filled; superset -> short transition
  s = logSet(s, b.id, s.exercises[0].sets[1].id, { now: 62000 });
  assert.equal(s.exercises[0].sets[1].reps, 8);
  assert.equal(s.exercises[0].sets[1].restBefore, 20, 'no Start tap: 60 s between sets minus ~40 s for the set');
  assert.equal(s.exercises[0].sets[1].restMeasured, false);
  assert.equal(s.restTarget, DEFAULT_SETTINGS.supersetRest);
  // pull-up (last in group) -> full rest
  s.exercises[1].sets[0].reps = 8;
  s = logSet(s, p.id, s.exercises[1].sets[0].id, { now: 80000, bodyweight: true });
  assert.equal(s.restTarget, 150);

  // myo-reps
  s.exercises[2].sets[0].weight = 25; s.exercises[2].sets[0].reps = 15;
  s = logSet(s, c.id, s.exercises[2].sets[0].id, { now: 200000 });
  assert.equal(s.restTarget, DEFAULT_SETTINGS.myoRest);
  let mini = s.exercises[2].sets[1];
  assert.equal(mini.type, SET.MYO_MINI);
  assert.equal(mini.target, 5);
  s = logSet(s, c.id, mini.id, { now: 220000 });
  assert.equal(s.exercises[2].sets.length, 3);
  mini = s.exercises[2].sets[2];
  s.exercises[2].sets[2].reps = 3;
  s = logSet(s, c.id, mini.id, { now: 240000 });
  assert.equal(s.exercises[2].sets.length, 3, 'stops after a missed mini-set');

  // unlog and re-log works
  s = unlogSet(s, c.id, mini.id);
  s = logSet(s, c.id, mini.id, { now: 241000 });
  assert.equal(s.exercises[2].sets.length, 3);

  s = addSet(s, b.id, SET.WORKING);
  assert.equal(s.exercises[0].sets.filter((x) => x.type === SET.WORKING).length, 3);
  assert.equal(s.exercises[0].sets.at(-1).type, SET.PARTIAL, 'extra working set is inserted before partials');

  s = finishSession(s, 1000 + 45 * 60000);
  assert.equal(s.status, 'done');
  assert.ok(s.exercises.every((e) => e.sets.every((x) => x.done)));

  const payload = buildPayload(s, {
    exercisesById, locationsById: { home: { name: 'Home' } }, sessions: [prior, s],
  });
  assert.equal(payload.sets.length, 2 + 1 + 3);
  assert.ok(payload.sets.every((r) => r.length === SET_HEADERS.length));
  assert.ok(payload.summary.every((r) => r.length === SUMMARY_HEADERS.length));
  assert.equal(payload.summary[0][5], 45);
  assert.equal(payload.summary[2][8], 'Myo 25 x 15+5+3');
  assert.deepEqual(payload.log.rows.map((r) => r.name), ['DB Bench', 'Pull-up', 'Curl']);
  assert.equal(payload.log.rows[2].log, 'Myo 25 x 15+5+3');
  assert.deepEqual([payload.log.block, payload.log.week], [1, 1]);
  assert.equal(historyFor('bench', [prior, s]).length, 2);
});

test('ending a myo block early removes the pending mini-set', () => {
  let s = startSession({
    template: { id: 't', name: 'T', items: [{ id: 'i', exerciseId: 'bench', sets: 0, myo: 1 }] },
    exercisesById: { bench: ex }, sessions: [], settings: DEFAULT_SETTINGS,
  });
  const e = s.exercises[0];
  s.exercises[0].sets[0].weight = 40; s.exercises[0].sets[0].reps = 12;
  s = logSet(s, e.id, e.sets[0].id);
  assert.equal(s.exercises[0].sets.length, 2);
  s = endMyoBlock(s, e.id, 0);
  assert.equal(s.exercises[0].sets.length, 1);
  assert.equal(myoNext(s.exercises[0].sets).phase, 'done');
});

test('warm-up load is not carried into work sets; typed loads are kept', () => {
  let s = startSession({
    template: { id: 't', name: 'T', items: [{ id: 'i', exerciseId: 'bench', warmups: 1, sets: 3 }] },
    exercisesById: { bench: ex }, sessions: [], settings: DEFAULT_SETTINGS,
  });
  const e = s.exercises[0];
  Object.assign(s.exercises[0].sets[0], { weight: 20, reps: 10 });
  s = logSet(s, e.id, e.sets[0].id);
  assert.equal(s.exercises[0].sets[1].weight, null);
  Object.assign(s.exercises[0].sets[1], { weight: 45, reps: 10, weightEdited: true });
  Object.assign(s.exercises[0].sets[3], { weight: 40, weightEdited: true });
  s = logSet(s, e.id, e.sets[1].id);
  assert.equal(s.exercises[0].sets[2].weight, 45);
  assert.equal(s.exercises[0].sets[3].weight, 40);
});

test('starter library is valid', async () => {
  const { seedExercises } = await import('../src/seed.js');
  const list = seedExercises();
  assert.equal(list.length, 20);
  assert.ok(list.find((e) => e.name === 'Pull-Ups/Chin-Ups'));
  assert.equal(new Set(list.map((e) => e.name)).size, list.length);
  for (const e of list) assert.ok(e.repMin < e.repMax && e.increment > 0, e.name);
  assert.ok(list.find((e) => e.name === 'Pull-Ups/Chin-Ups').bodyweight);
});

test('rest timer defaults: 3:00 compound, 1:30 isolation', async () => {
  const { seedLocations, seedExercises, seedTemplates } = await import('../src/seed.js');
  const { restFor, isCompound } = await import('../src/session-logic.js');
  const locs = seedLocations();
  const exs = seedExercises();
  const byName = (n) => exs.find((e) => e.name === n);
  assert.equal(restFor(byName('Deadlift (conventional)')), 180);
  assert.equal(restFor(byName('Seated Row (cable)')), 180);
  assert.equal(restFor(byName('Lateral (cable)')), 90);
  assert.equal(restFor(byName('Ab Exercise of Choice')), 90);
  assert.equal(isCompound({ repMin: 8, repMax: 10 }), true, 'older exercises without the flag');
  assert.equal(isCompound({ repMin: 10, repMax: 15 }), false);
  const s = startSession({
    template: seedTemplates(locs, exs)[0], exercisesById: Object.fromEntries(exs.map((e) => [e.id, e])),
    sessions: [], settings: DEFAULT_SETTINGS,
  });
  assert.deepEqual(s.exercises.map((e) => e.rest), [180, 180, 90, 90, 90]);
});

test('8-week cycle: week 8 is a deload, then week 1 of the next cycle', async () => {
  const { nextSlot } = await import('../src/program.js');
  const done = (week, t, extra = {}) => ({ id: 'u' + t, status: 'done', name: 'Upper 1', week, startedAt: t, exercises: [], ...extra });
  assert.deepEqual(nextSlot('Upper 1', [done(7, 1)]), { week: 8, cycle: 1, deload: true });
  assert.deepEqual(nextSlot('Upper 1', [done(7, 1), done(8, 2, { deload: true })]), { week: 1, cycle: 2, deload: false });
  assert.deepEqual(nextSlot('Upper 1', [done(8, 2, { cycle: 2 }), done(1, 3, { cycle: 3 })]), { week: 2, cycle: 3, deload: false });
  assert.deepEqual(nextSlot('Upper 1', []), { week: 1, cycle: 1, deload: false });
});

test('deload workout: last load, RIR 3-4, no rep targets, and it does not count toward progression', () => {
  const w7 = { id: 'w7', status: 'done', name: 'Upper 1', week: 7, cycle: 1, startedAt: 10,
    exercises: [{ id: 'x', exerciseId: 'bench', sets: w(50, 13, 13) }] };
  const tpl = { id: 't', name: 'Upper 1', items: [{ id: 'i', exerciseId: 'bench', sets: 2, rir: '1-2' }] };
  const s = startSession({ template: tpl, exercisesById: { bench: ex }, sessions: [w7], settings: DEFAULT_SETTINGS });
  assert.equal(s.week, 8);
  assert.equal(s.deload, true);
  const e = s.exercises[0];
  assert.equal(e.rir, '3-4');
  assert.equal(e.sets[0].weight, 50, 'last load, not the +5 increase');
  assert.equal(e.sets[0].target, null);

  // a deload at the same load that "hits the top" must not trigger an increase or count as a session
  const deload = { ...w7, id: 'w8', week: 8, deload: true, startedAt: 20, exercises: [{ id: 'y', exerciseId: 'bench', sets: w(50, 8, 8) }] };
  const next = startSession({ template: tpl, exercisesById: { bench: ex }, sessions: [w7, deload], settings: DEFAULT_SETTINGS });
  assert.deepEqual([next.week, next.cycle, next.deload], [1, 2, false]);
  assert.equal(next.exercises[0].suggestion.action, 'increase', 'based on week 7, ignoring the deload');
  assert.equal(next.exercises[0].rir, '1-2');
});

test('Start set / Done: real rest, planned rest and set duration', () => {
  const tpl = { id: 't', name: 'T', items: [{ id: 'i', exerciseId: 'bench', sets: 3, rest: 180, restCustom: true }] };
  let s = startSession({ template: tpl, exercisesById: { bench: ex }, sessions: [], settings: DEFAULT_SETTINGS, now: 0 });
  const id = (i) => s.exercises[0].sets[i].id;
  const sec = (x) => x * 1000;
  // set 1: start at 10 s, done at 50 s, reps entered at 70 s
  s = startSet(s, sec(10));
  s = endSet(s, sec(50));
  s.exercises[0].sets[0].reps = 10;
  s = logSet(s, s.exercises[0].id, id(0), { now: sec(70) });
  let set = s.exercises[0].sets[0];
  assert.deepEqual([set.startedAt, set.completedAt, set.duration, set.restBefore], [sec(10), sec(50), 40, null]);
  assert.equal(s.lastSetAt, sec(50), 'rest runs from Done, not from entering the reps');
  assert.equal(s.restTarget, 180);
  // set 2: went early, 2:00 into a 3:00 rest
  s = startSet(s, sec(170));
  s = endSet(s, sec(205));
  s.exercises[0].sets[1].reps = 9;
  s = logSet(s, s.exercises[0].id, id(1), { now: sec(220) });
  set = s.exercises[0].sets[1];
  assert.deepEqual([set.restBefore, set.restTarget, set.restMeasured, set.duration], [120, 180, true, 35]);
  // set 3: Start tapped by mistake, cancelled, then logged with plain ✓ -> estimated
  s = cancelSet(startSet(s, sec(260)));
  s.exercises[0].sets[2].reps = 8;
  s = logSet(s, s.exercises[0].id, id(2), { now: sec(500) });
  set = s.exercises[0].sets[2];
  assert.deepEqual([set.restBefore, set.restMeasured, set.duration], [255, false, null], '(500 - 205) s gap minus ~40 s for the set');
});

test('next set: workout order, superset-aware', () => {
  const curl = { id: 'curl', name: 'Curl', repMin: 10, repMax: 15, increment: 5 };
  const tpl = { id: 't', name: 'T', items: [
    { id: 'a', exerciseId: 'bench', sets: 2, group: 'A' }, { id: 'b', exerciseId: 'curl', sets: 2, group: 'A' },
  ] };
  let s = startSession({ template: tpl, exercisesById: { bench: ex, curl }, sessions: [], settings: DEFAULT_SETTINGS, now: 0 });
  assert.equal(nextPendingSet(s).exercise.exerciseId, 'bench');
  s.exercises[0].sets[0].reps = 10;
  s = logSet(s, s.exercises[0].id, s.exercises[0].sets[0].id, { now: 1000 });
  assert.equal(nextPendingSet(s).exercise.exerciseId, 'curl', 'superset: alternate');
  s.exercises[1].sets[0].reps = 12;
  s = logSet(s, s.exercises[1].id, s.exercises[1].sets[0].id, { now: 2000 });
  assert.equal(nextPendingSet(s).set.id, s.exercises[0].sets[1].id, 'back to bench set 2');
});
