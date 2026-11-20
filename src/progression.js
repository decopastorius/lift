// Pure training logic: set types, labels and double-progression rules.
// No browser APIs here so it can be unit-tested with `node --test`.

export const SET = {
  WARMUP: 'warmup',
  WORKING: 'working',
  MYO_ACT: 'myo-activation',
  MYO_MINI: 'myo-mini',
  PARTIAL: 'partial',
};

export const SET_NAME = {
  [SET.WARMUP]: 'Warm-up',
  [SET.WORKING]: 'Working',
  [SET.MYO_ACT]: 'Myo activation',
  [SET.MYO_MINI]: 'Myo mini-set',
  [SET.PARTIAL]: 'Lengthened partial',
};

export const isLogged = (s) => !!s && s.done && Number.isFinite(s.reps);

/** Short labels for display / the sheet: W1, 1, 2, MA, M1, P1 ... */
export function labelSets(sets) {
  const n = { w: 0, k: 0, m: 0, p: 0 };
  const blocks = new Set(sets.filter((s) => s.type === SET.MYO_ACT).map((s) => s.block || 0));
  const miniCount = {};
  return sets.map((s) => {
    switch (s.type) {
      case SET.WARMUP: return `W${++n.w}`;
      case SET.WORKING: return `${++n.k}`;
      case SET.MYO_ACT: return blocks.size > 1 ? `MA${(s.block || 0) + 1}` : 'MA';
      case SET.MYO_MINI: {
        const b = s.block || 0;
        miniCount[b] = (miniCount[b] || 0) + 1;
        return blocks.size > 1 ? `M${b + 1}.${miniCount[b]}` : `M${miniCount[b]}`;
      }
      case SET.PARTIAL: return `P${++n.p}`;
      default: return '?';
    }
  });
}

/**
 * The sets from one session's performance of an exercise that count toward
 * double progression: working sets (or, if the exercise was only done as
 * myo-reps, the activation sets), at the heaviest load used.
 */
export function progressionSets(sets) {
  const logged = (sets || []).filter(isLogged);
  const working = logged.filter((s) => s.type === SET.WORKING);
  const pool = working.length ? working : logged.filter((s) => s.type === SET.MYO_ACT);
  if (!pool.length) return [];
  const load = Math.max(...pool.map((s) => s.weight || 0));
  return pool.filter((s) => (s.weight || 0) === load);
}

export function summarize(sets) {
  const ps = progressionSets(sets);
  return { load: ps.length ? ps[0].weight || 0 : null, reps: ps.map((s) => s.reps) };
}

/**
 * Double progression.
 *
 * Add weight when EITHER:
 *   A) two sets in the most recent session went ABOVE the top of the rep range, or
 *   B) the last two sessions at the same load both reached the top of the range
 *      on every progression set.
 * RIR is ignored. Otherwise hold the load and aim for one more rep per set.
 *
 * @param {{repMin:number, repMax:number, increment:number, bodyweight?:boolean}} exercise
 * @param {{date:number, sets:object[]}[]} history oldest -> newest, excluding the current session
 */
export function suggest(exercise, history) {
  const repMin = Number(exercise.repMin) || 1;
  const repMax = Number(exercise.repMax) || repMin;
  const increment = Number(exercise.increment) || 0;
  const lt = (w) => (exercise.bodyweight ? (w ? `BW+${w} lb` : 'BW') : `${w} lb`);
  const perf = (history || [])
    .map((h) => ({ date: h.date, ...summarize(h.sets) }))
    .filter((p) => p.reps.length);

  if (!perf.length) {
    return {
      action: 'start', weight: null, targets: [], last: null,
      reason: `No history yet. Pick a load you can do for ${repMin}–${repMax} reps.`,
    };
  }

  const last = perf[perf.length - 1];
  const prev = perf[perf.length - 2];
  const topped = (p) => p.reps.every((r) => r >= repMax);
  const above = last.reps.filter((r) => r > repMax).length;

  let why = null;
  if (above >= 2) why = `${above} sets above ${repMax} reps last time`;
  else if (topped(last) && prev && prev.load === last.load && topped(prev)) {
    why = `Top of range (${repMax}) on every set two sessions in a row`;
  }

  if (why) {
    const weight = round(last.load + increment);
    const bw = exercise.bodyweight ? ' (vest/belt, or a harder variation)' : '';
    return {
      action: 'increase', weight, targets: last.reps.map(() => repMin), last,
      reason: `${why} → go to ${lt(weight)}${bw}, aim ${repMin}+ reps.`,
    };
  }

  const targets = last.reps.map((r) => (r >= repMax ? r : r + 1));
  let reason;
  if (topped(last)) reason = `Top of range at ${lt(last.load)} once. Do it again to earn the jump.`;
  else if (last.reps.some((r) => r < repMin)) reason = `Some sets were below ${repMin} reps. Keep the load (drop it if form is suffering).`;
  else reason = `Same load. Add a rep where you can.`;
  return { action: 'hold', weight: last.load, targets, last, reason };
}

/** Epley estimated 1RM, for history charts. */
export function e1rm(weight, reps) {
  if (!weight || !reps) return 0;
  return round(weight * (1 + reps / 30));
}

export function round(x) {
  return Math.round(x * 100) / 100;
}
