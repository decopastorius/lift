// Pure session operations. Functions take plain objects and return new ones.
import { SET, isLogged, suggest } from './progression.js';
import { myoNext, blockSets } from './myo.js';
import { uid } from './util.js';
import { defaultLayout, nextWeek } from './program.js';
import { DEFAULT_NOTE_PRESETS } from './pickers.js';

export const DEFAULT_SETTINGS = {
  id: 'settings',
  unit: 'lb',
  defaultRest: 120,      // fallback only
  compoundRest: 180,     // timer between sets of compound movements
  isolationRest: 90,     // timer between sets of isolation movements
  warmupRest: 60,
  myoRest: 15,           // between myo mini-sets (3–5 deep breaths)
  supersetRest: 15,      // transition between exercises inside a superset
  sound: true,
  keepAwake: true,
  sheetUrl: '',
  sheetSecret: '',
  notePresets: DEFAULT_NOTE_PRESETS,
  program: defaultLayout(), // the coach's sheet layout (blocks and rows, in sheet order)
};

export function newSet(type, extra = {}) {
  return { id: uid(), type, weight: null, reps: null, rir: null, done: false, target: null, block: 0, ...extra };
}

export function newPlanItem(exerciseId, settings = DEFAULT_SETTINGS) {
  return { id: uid(), exerciseId, warmups: 0, sets: 2, myo: 0, partials: 0, restMin: '', rir: '', group: '' };
}

/** History of one exercise across all finished sessions, oldest -> newest. */
export function historyFor(exerciseId, sessions, { before = Infinity, excludeId = null } = {}) {
  return sessions
    .filter((s) => s.status === 'done' && s.id !== excludeId && s.startedAt <= before)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => {
      const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
      return { date: s.startedAt, sessionId: s.id, locationId: s.locationId, sets };
    })
    .filter((h) => h.sets.some(isLogged));
}

export function suggestionFor(exercise, sessions, opts) {
  return suggest(exercise, historyFor(exercise.id, sessions, opts));
}

/** Build the in-session record for one exercise from a template item. */
/** Compound movements get the longer timer. Older exercises without the flag: 8–10 or lower ranges count as compound. */
export function isCompound(exercise) {
  if (typeof exercise?.compound === 'boolean') return exercise.compound;
  return (Number(exercise?.repMax) || 12) <= 10;
}

/** Rest timer for an exercise: a template's custom timer if set, else the compound / isolation default. */
export function restFor(exercise, settings = DEFAULT_SETTINGS, item = {}) {
  if (item.restCustom && item.rest) return item.rest;
  return isCompound(exercise) ? settings.compoundRest || 180 : settings.isolationRest || 90;
}

export function buildSessionExercise(item, exercise, suggestion, settings = DEFAULT_SETTINGS) {
  const w = suggestion?.weight ?? (exercise.bodyweight ? 0 : null);
  const tgt = (i) => {
    const t = suggestion?.targets || [];
    return t.length ? t[Math.min(i, t.length - 1)] : null;
  };
  const sets = [];
  for (let i = 0; i < (item.warmups || 0); i++) sets.push(newSet(SET.WARMUP));
  for (let i = 0; i < (item.sets || 0); i++) sets.push(newSet(SET.WORKING, { weight: w, target: tgt(i) }));
  for (let b = 0; b < (item.myo || 0); b++) sets.push(newSet(SET.MYO_ACT, { weight: w, block: b, target: tgt(0) }));
  for (let i = 0; i < (item.partials || 0); i++) sets.push(newSet(SET.PARTIAL, { weight: w }));
  return {
    id: uid(),
    exerciseId: exercise.id,
    group: item.group || '',
    rest: restFor(exercise, settings, item),
    rir: item.rir || '',
    restMin: item.restMin || '',
    plan: { warmups: item.warmups || 0, sets: item.sets || 0, myo: item.myo || 0, partials: item.partials || 0 },
    sets,
    notes: '',
    suggestion: suggestion || null,
  };
}

export function startSession({ template, locationId, exercisesById, sessions, settings, now = Date.now() }) {
  const items = template ? template.items : [];
  return {
    id: uid(),
    status: 'active',
    templateId: template?.id || null,
    name: template?.name || 'Workout',
    week: nextWeek(template?.name || 'Workout', sessions),
    locationId: template?.locationId || locationId || null,
    startedAt: now,
    endedAt: null,
    lastSetAt: null,
    restTarget: null,
    restLabel: '',
    notes: '',
    syncState: 'none',
    exercises: items
      .filter((it) => exercisesById[it.exerciseId])
      .map((it) => {
        const ex = exercisesById[it.exerciseId];
        return buildSessionExercise(it, ex, suggestionFor(ex, sessions), settings);
      }),
  };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Is there a later exercise in this session's superset group? */
function hasLaterInGroup(session, exIdx) {
  const g = session.exercises[exIdx].group;
  if (!g) return false;
  return session.exercises.slice(exIdx + 1).some((e) => e.group === g);
}

/** Mark a set as done, record rest taken, start the right rest timer, drive myo-reps. */
export function logSet(session, exId, setId, { now = Date.now(), settings = DEFAULT_SETTINGS, bodyweight = false } = {}) {
  const s = clone(session);
  const exIdx = s.exercises.findIndex((e) => e.id === exId);
  const ex = s.exercises[exIdx];
  const set = ex?.sets.find((x) => x.id === setId);
  if (!set) return session;
  if (set.reps == null) set.reps = set.target ?? null;
  if (set.reps == null) return session; // nothing to log
  if (set.weight == null) set.weight = bodyweight ? 0 : null;
  set.done = true;
  set.completedAt = now;
  set.restBefore = s.lastSetAt ? Math.round((now - s.lastSetAt) / 1000) : null;
  s.lastSetAt = now;

  // Carry the load forward to later sets whose weight wasn't typed by hand
  // (warm-up loads are never carried into work sets).
  if (set.type !== SET.WARMUP) {
    const idx = ex.sets.indexOf(set);
    for (const later of ex.sets.slice(idx + 1)) {
      if (!later.done && !later.weightEdited && later.type !== SET.WARMUP) later.weight = set.weight;
    }
  }

  let rest = ex.rest || settings.defaultRest;
  let label = 'Rest';

  if (set.type === SET.MYO_ACT || set.type === SET.MYO_MINI) {
    const block = set.block || 0;
    const next = myoNext(blockSets(ex.sets, block));
    if (next.phase === 'mini') {
      const pending = blockSets(ex.sets, block).some((x) => x.type === SET.MYO_MINI && !x.done);
      if (!pending) {
        const last = blockSets(ex.sets, block).at(-1);
        const at = ex.sets.indexOf(last) + 1;
        ex.sets.splice(at, 0, newSet(SET.MYO_MINI, { weight: set.weight, block, target: next.target }));
      }
      rest = settings.myoRest;
      label = `Breathe: mini-set ${next.index}`;
    }
  } else if (set.type === SET.WARMUP) {
    rest = settings.warmupRest;
    label = 'Warm-up rest';
  }

  if (label === 'Rest' || label === 'Warm-up rest') {
    if (hasLaterInGroup(s, exIdx) && set.type !== SET.WARMUP) {
      rest = settings.supersetRest;
      label = `Superset ${ex.group}: next exercise`;
    }
  }

  s.restTarget = rest;
  s.restLabel = label;
  return s;
}

export function unlogSet(session, exId, setId) {
  const s = clone(session);
  const ex = s.exercises.find((e) => e.id === exId);
  const set = ex?.sets.find((x) => x.id === setId);
  if (!set) return session;
  set.done = false;
  set.completedAt = null;
  set.restBefore = null;
  if (set.type === SET.MYO_ACT || set.type === SET.MYO_MINI) {
    // Drop empty pending mini-sets of this block; they get re-created when logging again.
    ex.sets = ex.sets.filter(
      (x) => !(x.type === SET.MYO_MINI && (x.block || 0) === (set.block || 0) && !x.done && x !== set && x.reps == null),
    );
    const act = ex.sets.find((x) => x.type === SET.MYO_ACT && (x.block || 0) === (set.block || 0));
    if (act) act.myoEnded = false;
  }
  return s;
}

export function endMyoBlock(session, exId, block) {
  const s = clone(session);
  const ex = s.exercises.find((e) => e.id === exId);
  if (!ex) return session;
  ex.sets = ex.sets.filter((x) => !(x.type === SET.MYO_MINI && (x.block || 0) === block && !x.done));
  const act = ex.sets.find((x) => x.type === SET.MYO_ACT && (x.block || 0) === block);
  if (act) act.myoEnded = true;
  s.restTarget = null;
  return s;
}

/** Add an extra set of a given type to an exercise in the session. */
export function addSet(session, exId, type) {
  const s = clone(session);
  const ex = s.exercises.find((e) => e.id === exId);
  if (!ex) return session;
  const ofType = ex.sets.filter((x) => x.type === type);
  const ref = ofType.at(-1) || ex.sets.filter((x) => x.type !== SET.WARMUP).at(-1);
  let extra = { weight: ref?.weight ?? null, target: type === SET.WORKING ? ref?.target ?? null : null };
  if (type === SET.WARMUP) extra = {};
  if (type === SET.MYO_ACT) {
    const blocks = ex.sets.filter((x) => x.type === SET.MYO_ACT).map((x) => x.block || 0);
    extra.block = blocks.length ? Math.max(...blocks) + 1 : 0;
  }
  const order = [SET.WARMUP, SET.WORKING, SET.MYO_ACT, SET.PARTIAL];
  const rank = (t) => order.indexOf(t === SET.MYO_MINI ? SET.MYO_ACT : t);
  // Insert after the last set whose type ranks <= this type.
  let at = ex.sets.length;
  for (let i = ex.sets.length - 1; i >= 0; i--) {
    if (rank(ex.sets[i].type) <= rank(type)) { at = i + 1; break; }
    at = i;
  }
  ex.sets.splice(at, 0, newSet(type, extra));
  return s;
}

export function removeSet(session, exId, setId) {
  const s = clone(session);
  const ex = s.exercises.find((e) => e.id === exId);
  if (!ex) return session;
  const set = ex.sets.find((x) => x.id === setId);
  ex.sets = ex.sets.filter((x) => x.id !== setId);
  if (set?.type === SET.MYO_ACT) ex.sets = ex.sets.filter((x) => !(x.type === SET.MYO_MINI && (x.block || 0) === (set.block || 0)));
  return s;
}

export function finishSession(session, now = Date.now()) {
  const s = clone(session);
  s.status = 'done';
  s.endedAt = now;
  s.restTarget = null;
  s.syncState = 'pending';
  for (const ex of s.exercises) ex.sets = ex.sets.filter((x) => x.done);
  return s;
}

/** Template items that mirror what was actually done in a session. */
export function itemsFromSession(session, settings = DEFAULT_SETTINGS) {
  return session.exercises.map((e) => {
    const count = (t) => e.sets.filter((x) => x.type === t).length;
    const done = e.sets.some((x) => x.done);
    return {
      id: uid(),
      exerciseId: e.exerciseId,
      warmups: done ? count(SET.WARMUP) : e.plan?.warmups || 0,
      sets: done ? count(SET.WORKING) : e.plan?.sets || 0,
      myo: done ? count(SET.MYO_ACT) : e.plan?.myo || 0,
      partials: done ? count(SET.PARTIAL) : e.plan?.partials || 0,
      restMin: e.restMin || '',
      rir: e.rir || '',
      group: e.group || '',
    };
  });
}
