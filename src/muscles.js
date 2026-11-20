// Weekly hard sets per muscle group. Pure: no browser APIs.
import { SET, isLogged } from './progression.js';
import { norm, weekOf } from './program.js';

export const MUSCLES = [
  'Chest', 'Back', 'Front delts', 'Side delts', 'Rear delts', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Lower back',
];

/** How sets are counted (editable in More → Volume counting). */
export const DEFAULT_VOLUME = {
  secondary: 0.5,     // a set counts this much for each secondary muscle
  myoMini: 1 / 3,     // each myo-rep mini-set (the activation set counts 1)
  // Lengthened partials. Training only the stretched part of the range, close to failure, has grown
  // muscle at least as well as full range (e.g. Pedrosa et al. on leg extensions, Kassiano et al. on
  // calves, Wolf et al. 2023 meta-analysis), so a partial set of its own counts as a full set.
  // Partials tacked on straight after failure are a handful of extra reps, like a myo mini-set.
  partial: 1,         // a lengthened-partial set of its own (rested, taken close to failure)
  partialAfter: 1 / 3, // partials straight after failure, with almost no rest
  partialRest: 30,    // a partial set logged within this many seconds of a set of the same exercise is "after failure"
  partialSecondary: false, // partials bias the stretched prime mover; helpers do little in that range
  maxRir: 4,          // sets logged above this RIR are not hard sets (count 0); blank RIR counts
  low: 10,            // typical weekly range shown on the charts
  high: 20,
};

const P = (primary, secondary = []) => ({ primary, secondary });

// First match wins. Order matters: "leg curl" before "curl", "leg extension" before "extension".
const RULES = [
  [/leg curl|hamstring curl|nordic/, P(['Hamstrings'])],
  [/leg extension/, P(['Quads'])],
  [/leg press|squat|lunge|step-?up/, P(['Quads'], ['Glutes'])],
  [/romanian|\brdl\b|good morning|stiff.?leg/, P(['Hamstrings'], ['Glutes', 'Lower back'])],
  [/deadlift/, P(['Glutes'], ['Hamstrings', 'Quads', 'Lower back'])],
  [/hip thrust|glute bridge|glute/, P(['Glutes'], ['Hamstrings'])],
  [/calf/, P(['Calves'])],
  [/\bab\b|abs\b|crunch|plank|leg raise|core|sit-?up/, P(['Abs'])],
  [/lateral raise|lateral \(|^lateral|side raise|upright row/, P(['Side delts'])],
  [/rear delt|face pull|reverse fly|reverse pec/, P(['Rear delts'])],
  [/pull-?down|pull-?up|chin-?up|lat /, P(['Back'], ['Biceps'])],
  [/row/, P(['Back'], ['Biceps', 'Rear delts'])],
  [/overhead press|shoulder press|military|\bohp\b|arnold/, P(['Front delts'], ['Triceps', 'Side delts'])],
  [/skull|pressdown|pushdown|triceps|overhead extension|extension \(cable\)|kickback|close.?grip/, P(['Triceps'])],
  [/curl/, P(['Biceps'])],
  [/fly|flye|pec deck|crossover/, P(['Chest'], ['Front delts'])],
  [/bench|incline|decline|chest press|push-?up|dip/, P(['Chest'], ['Triceps', 'Front delts'])],
];

const BY_CATEGORY = {
  chest: P(['Chest'], ['Triceps', 'Front delts']), back: P(['Back'], ['Biceps']), shoulders: P(['Side delts']),
  legs: P(['Quads'], ['Glutes']), core: P(['Abs']), abs: P(['Abs']),
};

/** {primary, secondary} muscles: the exercise's own setting, else guessed from its name, else its category. */
export function musclesFor(exercise) {
  if (exercise?.muscles?.primary?.length || exercise?.muscles?.secondary?.length) return exercise.muscles;
  const name = norm(exercise?.name);
  for (const [re, m] of RULES) if (re.test(name)) return m;
  return BY_CATEGORY[norm(exercise?.category)] || P([]);
}

/** How much one logged set counts toward weekly volume. */
export function setCredit(set, rules = DEFAULT_VOLUME, { afterFailure = false } = {}) {
  if (!isLogged(set) || set.type === SET.WARMUP) return 0;
  if (set.rir != null && Number.isFinite(set.rir) && set.rir > rules.maxRir) return 0;
  if (set.type === SET.MYO_MINI) return rules.myoMini;
  if (set.type === SET.PARTIAL) return afterFailure ? rules.partialAfter : rules.partial;
  return 1; // working set or myo activation
}

/**
 * Was this partial set done straight after failure (vs. a set of its own)? Your choice in the set
 * panel wins; otherwise: logged within `partialRest` seconds of a set of the same exercise.
 * @param prev the set logged just before it in the session (any exercise), with its exerciseId
 */
export function partialAfterFailure(set, prev, exerciseId, rules = DEFAULT_VOLUME) {
  if (set.type !== SET.PARTIAL) return false;
  if (set.partialMode === 'after') return true;
  if (set.partialMode === 'own') return false;
  return !!prev && prev.exerciseId === exerciseId && prev.set.type !== SET.WARMUP
    && set.restBefore != null && set.restBefore <= rules.partialRest;
}

/** A copy of the session with `afterFailure` set on each partial set (for display and the coach's log). */
export function markPartials(session, rules = DEFAULT_VOLUME) {
  const after = new Set(chronological(session).filter((x) => partialAfterFailure(x.set, x.prev, x.exerciseId, rules)).map((x) => x.set.id));
  return {
    ...session,
    exercises: session.exercises.map((e) => ({
      ...e, sets: e.sets.map((x) => (x.type === SET.PARTIAL ? { ...x, afterFailure: after.has(x.id) } : x)),
    })),
  };
}

/** Each logged set of a session in the order it was done, with the set before it. */
function chronological(session) {
  const all = session.exercises.flatMap((e) => e.sets.filter(isLogged).map((set) => ({ exerciseId: e.exerciseId, set })));
  all.sort((a, b) => (a.set.completedAt || 0) - (b.set.completedAt || 0));
  return all.map((x, i) => ({ ...x, prev: x.set.completedAt ? all[i - 1] : null }));
}

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Hard sets per muscle for every program week (block + week), oldest first.
 * @returns {{key, block, week, deload, total, muscles: {[m]: number}, from: {[m]: {[exercise]: number}}}[]}
 */
export function weeklyVolume(sessions, exercisesById, rules = DEFAULT_VOLUME) {
  const done = sessions.filter((s) => s.status === 'done').sort((a, b) => a.startedAt - b.startedAt);
  const weeks = new Map();
  for (const s of done) {
    const block = s.cycle || 1;
    const week = weekOf(s, done);
    const key = `${block}|${week}`;
    if (!weeks.has(key)) weeks.set(key, { key, block, week, deload: false, start: s.startedAt, total: 0, muscles: {}, from: {} });
    const w = weeks.get(key);
    if (s.deload) w.deload = true;
    const after = new Set(chronological(s).filter((x) => partialAfterFailure(x.set, x.prev, x.exerciseId, rules)).map((x) => x.set));
    for (const e of s.exercises) {
      const ex = exercisesById[e.exerciseId];
      if (!ex) continue;
      let credit = 0;     // counts for the primary muscles
      let secondary = 0;  // counts for the secondary muscles (partials only if enabled)
      for (const set of e.sets) {
        const c = setCredit(set, rules, { afterFailure: after.has(set) });
        credit += c;
        if (set.type !== SET.PARTIAL || rules.partialSecondary) secondary += c;
      }
      if (!credit) continue;
      w.total += credit;
      const m = musclesFor(ex);
      const add = (muscle, x) => {
        w.muscles[muscle] = (w.muscles[muscle] || 0) + x;
        w.from[muscle] = w.from[muscle] || {};
        w.from[muscle][ex.name] = (w.from[muscle][ex.name] || 0) + x;
      };
      for (const p of m.primary) add(p, credit);
      if (secondary) for (const p of m.secondary) add(p, secondary * rules.secondary);
    }
  }
  const out = [...weeks.values()].sort((a, b) => a.block - b.block || a.week - b.week);
  for (const w of out) {
    w.total = r1(w.total);
    for (const k of Object.keys(w.muscles)) w.muscles[k] = r1(w.muscles[k]);
    for (const k of Object.keys(w.from)) for (const n of Object.keys(w.from[k])) w.from[k][n] = r1(w.from[k][n]);
  }
  return out;
}

export const weekLabel = (w) => `B${w.block}·W${w.week}`;
