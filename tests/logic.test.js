import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, labelSets, SET } from '../src/progression.js';
import { myoNext, miniTarget } from '../src/myo.js';
import {
  startSession, logSet, unlogSet, finishSession, endMyoBlock, addSet, historyFor, DEFAULT_SETTINGS,
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
      { id: 'i1', exerciseId: 'bench', warmups: 1, sets: 2, myo: 0, partials: 1, rest: 150, group: 'A' },
      { id: 'i2', exerciseId: 'pull', warmups: 0, sets: 2, myo: 0, partials: 0, rest: 150, group: 'A' },
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
  assert.equal(s.exercises[0].sets[1].restBefore, 60);
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
  assert.equal(payload.summary[0][4], 45);
  assert.equal(payload.summary[2][10], '25: 15+5+3');
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
