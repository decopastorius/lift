import test from 'node:test';
import assert from 'node:assert/strict';
import { SET } from '../src/progression.js';
import { musclesFor, setCredit, weeklyVolume, markPartials, DEFAULT_VOLUME } from '../src/muscles.js';
import { formatLog, parseLog } from '../src/program.js';
import { suggest } from '../src/progression.js';
import { classify, performance, exposures, exerciseStatus, analyse } from '../src/fatigue.js';

const set = (type, weight, reps, rir = null) => ({ type, weight, reps, rir, done: true });
const W = (weight, reps, rir) => set(SET.WORKING, weight, reps, rir);

test('muscles: guessed from the name, overridable', () => {
  assert.deepEqual(musclesFor({ name: 'Seated Leg Curl (machine)' }), { primary: ['Hamstrings'], secondary: [] });
  assert.deepEqual(musclesFor({ name: 'Standing Curl (DB / bilateral or unilateral)' }).primary, ['Biceps']);
  assert.deepEqual(musclesFor({ name: 'Leg Extension' }).primary, ['Quads']);
  assert.deepEqual(musclesFor({ name: 'Overhead Extension (cable)' }).primary, ['Triceps']);
  assert.deepEqual(musclesFor({ name: 'Incline DB Press (15-30°)' }), { primary: ['Chest'], secondary: ['Triceps', 'Front delts'] });
  assert.deepEqual(musclesFor({ name: 'Mystery move', category: 'Back' }).primary, ['Back']);
  assert.deepEqual(musclesFor({ name: 'Leg Extension', muscles: { primary: ['Quads'], secondary: ['Glutes'] } }).secondary, ['Glutes']);
});

test('set credit: hard sets only; myo mini-sets and after-failure partials count less', () => {
  assert.equal(setCredit(W(100, 8, 1)), 1);
  assert.equal(setCredit(W(100, 8, null)), 1, 'blank RIR counts');
  assert.equal(setCredit(W(0, 15, 5)), 0, 'RIR 5 is not a hard set');
  assert.equal(setCredit(set(SET.WARMUP, 50, 10)), 0);
  assert.equal(setCredit(set(SET.MYO_ACT, 20, 15)), 1);
  assert.equal(setCredit(set(SET.MYO_MINI, 20, 5)), 1 / 3);
  assert.equal(setCredit(set(SET.PARTIAL, 20, 8)), 1, 'a partial set of its own is a full set');
  assert.equal(setCredit(set(SET.PARTIAL, 20, 5), DEFAULT_VOLUME, { afterFailure: true }), 1 / 3);
  assert.equal(setCredit(set(SET.PARTIAL, 20, 8, 6)), 0, 'still has to be hard');
  assert.equal(setCredit(W(0, 15, 5), { ...DEFAULT_VOLUME, maxRir: 5 }), 1);
});

const ex = {
  bench: { id: 'bench', name: 'Barbell Bench Press' },
  row: { id: 'row', name: 'Seated Row (cable)' },
  lat: { id: 'lat', name: 'Lateral (cable)' },
};
const session = (id, block, week, startedAt, exercises, extra = {}) => ({
  id, status: 'done', cycle: block, week, startedAt, name: 'Upper 1',
  exercises: Object.entries(exercises).map(([exerciseId, sets]) => ({ id: id + exerciseId, exerciseId, sets })), ...extra,
});

test('weekly volume per muscle: primary 1, secondary ½, myo fractional, own-set partials 1', () => {
  const s = [
    session('a', 2, 1, 1, { bench: [W(125, 10, 1), W(125, 9, 0)], row: [W(165, 12, 1), W(165, 12, 0)] }),
    session('b', 2, 1, 2, {
      lat: [set(SET.MYO_ACT, 30, 15, 1), set(SET.MYO_MINI, 30, 5), set(SET.MYO_MINI, 30, 5), set(SET.MYO_MINI, 30, 4), set(SET.PARTIAL, 30, 10)],
    }),
    session('c', 2, 2, 3, { bench: [W(130, 8, 1)] }),
  ];
  const [w1, w2] = weeklyVolume(s, ex);
  assert.equal(w1.muscles.Chest, 2);
  assert.equal(w1.muscles.Back, 2);
  assert.equal(w1.muscles.Triceps, 1, 'two bench sets x ½');
  assert.equal(w1.muscles.Biceps, 1, 'two row sets x ½');
  assert.equal(w1.muscles['Side delts'], 3, '1 activation + 3 x ⅓ + 1 partial set (no times: own set)');
  assert.equal(w1.total, 7);
  assert.deepEqual(w1.from.Triceps, { 'Barbell Bench Press': 1 });
  assert.deepEqual([w2.block, w2.week, w2.muscles.Chest], [2, 2, 1]);
});

test('classify exposures the double-progression way', () => {
  const p = (w, reps, rir) => performance(reps.map((r, i) => W(w, r, rir?.[i] ?? null)));
  assert.equal(classify(p(165, [12, 12]), p(170, [9, 9])), 'P', 'load up is progress even with fewer reps');
  assert.equal(classify(p(170, [9, 9]), p(170, [10, 9])), 'P');
  assert.equal(classify(p(170, [10, 9]), p(170, [10, 9])), 'F');
  assert.equal(classify(p(170, [10, 9], [2, 1]), p(170, [10, 9], [0, 0])), 'G', 'same output, harder');
  assert.equal(classify(p(170, [10, 9], [0, 0]), p(170, [10, 9], [1, 1])), 'P', 'same output, easier');
  assert.equal(classify(p(170, [10, 9]), p(170, [9, 8])), 'R');
  assert.equal(classify(p(55, [11, 10]), p(50, [15, 12])), 'R', 'load down');
});

test('status: progressing, grinding, stalled, regressing; deloads ignored', () => {
  const seq = (...xs) => xs.map((x, i) => session('s' + i, 2, i + 1, i, { row: x }));
  const st = (sessions) => exerciseStatus(exposures('row', sessions)).key;
  assert.equal(st(seq([W(160, 10)], [W(160, 11)], [W(165, 8)])), 'progressing');
  assert.equal(st(seq([W(160, 10)], [W(165, 8)], [W(165, 8)], [W(165, 8)], [W(165, 8)])), 'stalled');
  assert.equal(st(seq([W(160, 10)], [W(165, 9)], [W(165, 8)], [W(165, 7)])), 'regressing');
  assert.equal(st(seq([W(160, 10, 2)], [W(165, 9, 2)], [W(165, 9, 0)])), 'grinding');
  // a deload in between is skipped, not counted as a regression
  const withDeload = seq([W(160, 10)], [W(165, 9)], [W(165, 10)]);
  withDeload.splice(2, 0, session('d', 2, 8, 1.5, { row: [W(120, 6, 4)] }, { deload: true }));
  assert.equal(st(withDeload), 'progressing');
});

test('alerts: whole-body signal and a muscle with more sets but less progress', () => {
  // 4 weeks: row stalls then regresses while back volume goes 2 -> 4 sets; bench and lateral stall too
  const sessions = [];
  const plan = [
    [[W(160, 10)], [W(100, 8)], [W(30, 15)]],
    [[W(160, 11)], [W(100, 9)], [W(30, 16)]],
    [[W(160, 11), W(160, 10), W(160, 10), W(160, 10)], [W(100, 9)], [W(30, 16)]],
    [[W(160, 10), W(160, 9), W(160, 9), W(160, 9)], [W(100, 9)], [W(30, 16)]],
    [[W(160, 9), W(160, 9), W(160, 8), W(160, 8)], [W(100, 9)], [W(30, 16)]],
  ];
  plan.forEach(([row, bench, lat], i) => sessions.push(session('w' + i, 2, i + 1, i, { row, bench, lat })));
  const vol = weeklyVolume(sessions, ex);
  const { exercises, alerts } = analyse(sessions, ex, vol);
  assert.equal(exercises.find((x) => x.exercise.id === 'row').status.key, 'regressing');
  assert.equal(exercises.find((x) => x.exercise.id === 'bench').status.key, 'stalled');
  const titles = alerts.map((a) => a.title);
  assert.ok(titles.includes('Whole-body fatigue signal'), titles.join(' / '));
  assert.ok(titles.includes('Back: more sets, less progress'), titles.join(' / '));
});

test('lengthened partials: own set vs straight after failure (by rest, or chosen), main muscle only', () => {
  const t = (sec) => 1000 * sec;
  const bench = (id, sets) => ({ id, status: 'done', cycle: 1, week: 1, startedAt: 0, name: 'Upper', exercises: [{ id: 'e', exerciseId: 'bench', sets }] });
  const S = (type, w, r, at, rest, extra = {}) => ({ id: type + at, type, weight: w, reps: r, rir: 0, done: true, completedAt: t(at), restBefore: rest, ...extra });
  // set 1, set 2, then 4 partial reps 10 s later (after failure), then a rested partial set
  const s = bench('a', [S(SET.WORKING, 125, 9, 0, null), S(SET.WORKING, 125, 8, 180, 180), S(SET.PARTIAL, 125, 4, 190, 10), S(SET.PARTIAL, 105, 10, 370, 180)]);
  const [w] = weeklyVolume([s], ex);
  assert.equal(w.muscles.Chest, 3.3, 'Chest: 2 full sets + ⅓ (after failure) + 1 (own set), rounded');
  assert.equal(w.muscles.Triceps, 1, 'secondary muscles: only the 2 full sets x ½');
  // choosing "own set" overrides the short rest
  const own = bench('b', [S(SET.WORKING, 125, 9, 0, null), S(SET.PARTIAL, 125, 4, 10, 10, { partialMode: 'own' })]);
  assert.equal(weeklyVolume([own], ex)[0].muscles.Chest, 2);
  // partials can count for secondary muscles if you want
  assert.equal(weeklyVolume([s], ex, { ...DEFAULT_VOLUME, partialSecondary: true })[0].muscles.Triceps, 1.7);
  // the coach's log says which is which, and reads back
  const log = formatLog(markPartials(s).exercises[0].sets);
  assert.equal(log, '125 x 9, 8 | RIR 0, 0 | Partials 105 x 10 | Partials (after failure) 125 x 4');
  assert.equal(parseLog(log).filter((x) => x.partialMode === 'after').length, 1);
});

test('an exercise done only as lengthened partials still gets progression', () => {
  const p = (w, ...reps) => reps.map((r) => ({ type: SET.PARTIAL, weight: w, reps: r, done: true }));
  const sug = suggest({ repMin: 8, repMax: 12, increment: 5 }, [{ date: 1, sets: p(40, 13, 13) }]);
  assert.equal(sug.action, 'increase');
  assert.equal(sug.weight, 45);
});

test('a stall with a rushed rest is pointed out', () => {
  const R = (w, r, rest, measured = true) => ({ type: SET.WORKING, weight: w, reps: r, done: true, restBefore: rest, restTarget: 180, restMeasured: measured });
  const mk = (i, sets) => session('r' + i, 2, i + 1, i, { row: sets });
  const list = exposures('row', [mk(0, [R(160, 10, null), R(160, 10, 185)]), mk(1, [R(160, 10, null), R(160, 8, 95)])]);
  const st = exerciseStatus(list);
  assert.deepEqual(st.shortRest, { taken: 95, planned: 180, measured: true });
  // properly rested regression: no note
  const list2 = exposures('row', [mk(0, [R(160, 10, null), R(160, 10, 185)]), mk(1, [R(160, 10, null), R(160, 8, 190)])]);
  assert.equal(exerciseStatus(list2).shortRest, null);
});
