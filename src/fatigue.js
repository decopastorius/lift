// Progression and fatigue signals. Pure: no browser APIs.
//
// e1RM is the wrong yardstick for double progression: every earned load jump drops the reps
// (165 x 12 -> 170 x 9 looks like a loss). Instead each exposure (a session with that exercise,
// deloads excluded) is judged against the previous one:
//   P  progress  - load went up; or same load and more reps per set; or same reps, easier (higher RIR)
//   F  flat      - same load, same reps, same effort
//   G  grind     - same load and reps, but harder (lower RIR): output flat while effort rises
//   R  regress   - fewer reps at the same load, or the load went down
import { SET, isLogged } from './progression.js';
import { weekOf } from './program.js';
import { musclesFor } from './muscles.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One exercise's performance in one session: top working load, reps per set at it, average RIR. */
export function performance(sets) {
  const logged = (sets || []).filter(isLogged);
  let pool = logged.filter((s) => s.type === SET.WORKING);
  if (!pool.length) pool = logged.filter((s) => s.type === SET.MYO_ACT);
  if (!pool.length) return null;
  const load = Math.max(...pool.map((s) => s.weight || 0));
  const top = pool.filter((s) => (s.weight || 0) === load);
  const rirs = top.map((s) => s.rir).filter((x) => x != null && Number.isFinite(x));
  return { load, reps: top.map((s) => s.reps), meanReps: mean(top.map((s) => s.reps)), rir: rirs.length ? mean(rirs) : null };
}

export function classify(prev, cur) {
  if (!prev) return 'S'; // start
  if (cur.load > prev.load) return 'P';
  if (cur.load < prev.load) return 'R';
  if (cur.meanReps > prev.meanReps + 0.01) return 'P';
  if (cur.meanReps < prev.meanReps - 0.01) return 'R';
  if (cur.rir != null && prev.rir != null) {
    if (cur.rir > prev.rir + 0.01) return 'P';
    if (cur.rir < prev.rir - 0.01) return 'G';
  }
  return 'F';
}

/** Every non-deload exposure of an exercise, oldest first, each classified against the one before. */
export function exposures(exerciseId, sessions) {
  const done = sessions.filter((s) => s.status === 'done' && !s.deload).sort((a, b) => a.startedAt - b.startedAt);
  const out = [];
  for (const s of done) {
    const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
    const perf = performance(sets);
    if (!perf) continue;
    out.push({ sessionId: s.id, date: s.startedAt, block: s.cycle || 1, week: weekOf(s, done), ...perf, code: classify(out.at(-1), perf) });
  }
  return out;
}

export const STATUS = {
  progressing: { label: 'Progressing', icon: '▲', tone: 'good' },
  grinding: { label: 'Grinding', icon: '◆', tone: 'warning' },
  stalled: { label: 'Stalled', icon: '▬', tone: 'serious' },
  regressing: { label: 'Regressing', icon: '▼', tone: 'critical' },
  new: { label: 'Not enough data', icon: '·', tone: 'muted' },
};

/**
 * Status from the last few exposures:
 *   regressing - 2 of the last 3 went backwards
 *   stalled    - 3 in a row without progress
 *   grinding   - the last one was a grind, or the last two were flat with RIR dropping
 *   progressing- otherwise, with progress in the last 3
 */
export function exerciseStatus(list) {
  const codes = list.map((x) => x.code).filter((c) => c !== 'S');
  if (!codes.length) return { key: 'new', since: 0, codes };
  const last3 = codes.slice(-3);
  let since = 0;
  for (let i = codes.length - 1; i >= 0 && codes[i] !== 'P'; i--) since++;
  const last2 = codes.slice(-2);
  const rirNow = list.at(-1)?.rir;
  const rirBefore = list.at(-3)?.rir;
  const grindTrend = last2.length === 2 && last2.every((c) => c === 'F' || c === 'G')
    && rirNow != null && rirBefore != null && rirNow < rirBefore;
  let key = 'new';
  if (last3.filter((c) => c === 'R').length >= 2) key = 'regressing';
  else if (last3.length === 3 && !last3.includes('P')) key = 'stalled';
  else if (codes.at(-1) === 'G' || grindTrend) key = 'grinding';
  else if (last3.includes('P')) key = 'progressing';
  return { key, since, codes };
}

/** Share of exposures in each program week that progressed (deload weeks have none). */
export function weeklyProgress(byExercise) {
  const weeks = new Map();
  for (const list of Object.values(byExercise)) {
    for (const x of list) {
      if (x.code === 'S') continue;
      const key = `${x.block}|${x.week}`;
      if (!weeks.has(key)) weeks.set(key, { key, block: x.block, week: x.week, n: 0, p: 0, r: 0 });
      const w = weeks.get(key);
      w.n++;
      if (x.code === 'P') w.p++;
      if (x.code === 'R') w.r++;
    }
  }
  return [...weeks.values()]
    .map((w) => ({ ...w, rate: w.n ? w.p / w.n : null }))
    .sort((a, b) => a.block - b.block || a.week - b.week);
}

/**
 * Everything the Progress screen needs.
 * @returns {{exercises: {exercise, list, status}[], weeks, alerts: {tone, title, text}[]}}
 */
export function analyse(sessions, exercisesById, volume, { cycleWeeks = 8 } = {}) {
  const used = new Set(sessions.filter((s) => s.status === 'done').flatMap((s) => s.exercises.map((e) => e.exerciseId)));
  const byExercise = {};
  const exercises = [];
  for (const id of used) {
    const ex = exercisesById[id];
    if (!ex) continue;
    const list = exposures(id, sessions);
    if (!list.length) continue;
    byExercise[id] = list;
    exercises.push({ exercise: ex, list, status: exerciseStatus(list) });
  }
  const order = { regressing: 0, stalled: 1, grinding: 2, progressing: 3, new: 4 };
  exercises.sort((a, b) => order[a.status.key] - order[b.status.key] || a.exercise.name.localeCompare(b.exercise.name));
  const weeks = weeklyProgress(byExercise);

  const alerts = [];
  // only exercises seen recently (last 3 program weeks with data) count toward the whole-body signal
  const recentKeys = new Set(weeks.slice(-3).map((w) => w.key));
  const recent = exercises.filter((x) => x.list.some((e) => recentKeys.has(`${e.block}|${e.week}`)) && x.status.key !== 'new');
  const bad = recent.filter((x) => x.status.key === 'stalled' || x.status.key === 'regressing');
  const last = weeks.at(-1);
  if (recent.length >= 3 && bad.length / recent.length >= 0.3) {
    const when = last && last.week >= cycleWeeks - 2 ? 'The deload is close, which is when this is expected.'
      : last && last.week <= 3 ? 'This is early in the block: look at sleep, food and stress before adding volume.'
        : 'Consider holding volume steady or deloading early if it persists.';
    alerts.push({
      tone: 'serious', title: 'Whole-body fatigue signal',
      text: `${bad.length} of ${recent.length} recent exercises are stalled or regressing. ${when}`,
    });
  }
  // a muscle whose volume rose while one of its main exercises is going backwards
  const nonDeload = volume.filter((w) => !w.deload);
  if (nonDeload.length >= 4) {
    const avg = (ws, m) => mean(ws.map((w) => w.muscles[m] || 0));
    const now = nonDeload.slice(-2);
    const before = nonDeload.slice(-4, -2);
    for (const x of exercises.filter((e) => e.status.key === 'regressing' || e.status.key === 'stalled')) {
      for (const m of musclesFor(x.exercise).primary) {
        const a = avg(before, m);
        const b = avg(now, m);
        if (a > 0 && b >= a * 1.2) {
          alerts.push({
            tone: 'warning', title: `${m}: more sets, less progress`,
            text: `${m} went from ${a.toFixed(1)} to ${b.toFixed(1)} sets a week while ${x.exercise.name} is ${STATUS[x.status.key].label.toLowerCase()}. That volume may be more than you can recover from right now.`,
          });
        }
      }
    }
  }
  // falling share of progressing exercises over the last weeks
  const rated = weeks.filter((w) => w.n >= 3);
  if (rated.length >= 3) {
    const [a, b, c] = rated.slice(-3).map((w) => w.rate);
    if (a > b && b > c && c < 0.5) {
      alerts.push({
        tone: 'warning', title: 'Progress rate falling',
        text: `Exercises progressing per week: ${Math.round(a * 100)}% → ${Math.round(b * 100)}% → ${Math.round(c * 100)}%. Fatigue is accumulating faster than you recover.`,
      });
    }
  }
  return { exercises, weeks, alerts };
}

export const codeName = { P: 'progress', F: 'flat', G: 'grind (harder, same output)', R: 'regress', S: 'first' };
