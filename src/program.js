// The coach's sheet format: program blocks, location tags, "Load x reps" log cells, weeks.
// Pure functions (no browser APIs) so they can be unit-tested.
import { SET, isLogged } from './progression.js';
import { blockSets, myoNext } from './myo.js';

/**
 * Starting program (structure only). Tag letters are the first letter of a location name:
 * h = Home, c = Cottage, hc = either. [tag, exercise, sets, RIR target, rest (min)]
 */
export const PROGRAM = [
  {
    name: 'Upper 1',
    rows: [
      ['c', 'Chest Supported DB Row', 2, '0-1', '3-4'],
      ['h', 'Seated Row (cable)', 2, '0-1', '3-4'],
      ['c', 'DB Bench Press (horizontal)', 2, '1-2', '3-4'],
      ['h', 'Barbell Bench Press (horizontal)', 2, '1-2', '3-4'],
      ['c', 'Lateral (DB)', 2, '0-1', '1-3'],
      ['h', 'Lateral (cable)', 2, '0-1', '1-3'],
      ['c', 'Skullcrucher DB', 2, '0-1', '1-3'],
      ['h', 'Cable Pressdown (rope)', 2, '0-1', '1-3'],
      ['hc', 'Standing Curl (DB / bilateral or unilateral)', 2, '0-1', '1-3'],
    ],
  },
  {
    name: 'Lower 1',
    rows: [
      ['h', 'Split Squat (Smith Machine)', 2, '2-3', '3-4'],
      ['c', 'Split Squat (DB)', 2, '2-3', '3-4'],
      ['c', 'RDL (Romanian Deadlift / DB / bilateral or unilateral)', 2, '2-3', '3-4'],
      ['h', 'Deadlift (conventional)', 2, '2-3', '3-4'],
      ['h', 'Seated Leg Curl (machine)', 2, '1-2', '1-3'],
      ['h', 'Leg Extension', 2, '1-2', '1-3'],
      ['hc', 'Ab Exercise of Choice', 2, '1-2', '1-3'],
    ],
  },
  {
    name: 'Upper 2',
    rows: [
      ['h', 'Incline Barbell Press (15-30°)', 2, '1-2', '3-4'],
      ['c', 'Incline DB Press (15-30°)', 2, '1-2', '3-4'],
      ['h', 'Cable Pull-Downs (neutral grip)', 2, '0-1', '3-4'],
      ['c', 'Pull-Ups/Chin-Ups', 2, '0-1', '3-4'],
      ['h', 'Lateral (cable)', 2, '0-1', '1-3'],
      ['c', 'Lateral (DB)', 2, '0-1', '1-3'],
      ['h', 'Cable Pressdown (rope)', 2, '0-1', '1-3'],
      ['c', 'Skullcrucher DB', 2, '0-1', '1-3'],
      ['hc', 'Standing Curl (DB / bilateral or unilateral)', 2, '0-1', '1-3'],
    ],
  },
];

export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const locLetter = (loc) => norm(loc?.name).charAt(0);

/** "3-4" -> 180 s (timer goes off at the low end of the range); "2.5" -> 150; "" -> null */
export function restSeconds(restMin) {
  const m = String(restMin ?? '').match(/(\d+(?:[.,]\d+)?)/);
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * 60) : null;
}

/** Program week (1-based) of a timestamp, counting 7-day weeks from the start date (YYYY-MM-DD). */
export function weekNumber(ts, programStart) {
  if (!programStart) return 1;
  const [y, mo, d] = programStart.split('-').map(Number);
  const start = new Date(y, mo - 1, d);
  const t = new Date(ts);
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const days = Math.round((day - start) / 86400000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/** Start date of a program week, as a timestamp at the given hour. */
export function weekStartTs(programStart, week, dayOffset = 0, hour = 12) {
  const [y, mo, d] = programStart.split('-').map(Number);
  return new Date(y, mo - 1, d + (week - 1) * 7 + dayOffset, hour).getTime();
}

const fmtNum = (n) => String(Math.round(n * 100) / 100);
function loadText(w, bodyweight) {
  if (bodyweight) return w ? `BW+${fmtNum(w)}` : 'BW';
  return fmtNum(w || 0);
}

function groupByLoad(sets, bodyweight, sep = ', ') {
  const groups = [];
  for (const s of sets) {
    const l = loadText(s.weight, bodyweight);
    const g = groups.at(-1);
    if (g && g.l === l) g.r.push(s.reps); else groups.push({ l, r: [s.reps] });
  }
  return groups.map((g) => `${g.l} x ${g.r.join(sep)}`).join(sep);
}

/**
 * The coach's cell format:
 *   "165 x 12, 12 | RIR 1, 0"     "70 x 20, 85 x 12 | RIR 2, 0"     "BW x 15, 15"
 * plus, when done, "| Myo 20 x 15+5+4" and "| Partials 20 x 8, 8".
 */
export function formatLog(sets, bodyweight = false) {
  const logged = (sets || []).filter(isLogged);
  const parts = [];
  const work = logged.filter((s) => s.type === SET.WORKING);
  if (work.length) {
    let t = groupByLoad(work, bodyweight);
    if (work.some((s) => s.rir != null)) t += ` | RIR ${work.map((s) => s.rir ?? '-').join(', ')}`;
    parts.push(t);
  }
  const blocks = [...new Set(logged.filter((s) => s.type === SET.MYO_ACT).map((s) => s.block || 0))];
  for (const b of blocks) {
    const bs = blockSets(logged, b);
    parts.push(`Myo ${loadText(bs[0].weight, bodyweight)} x ${myoNext(bs).total}`);
  }
  const partials = logged.filter((s) => s.type === SET.PARTIAL);
  if (partials.length) parts.push(`Partials ${groupByLoad(partials, bodyweight)}`);
  return parts.join(' | ');
}

function parseLoad(tok) {
  const t = tok.trim().toUpperCase().replace(/\s+/g, '');
  if (t === 'BW') return 0;
  const bw = t.match(/^BW\+(\d+(?:\.\d+)?)$/);
  if (bw) return Number(bw[1]);
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Inverse of formatLog. Returns set objects (done) or [] if the cell isn't a log. */
export function parseLog(text) {
  const out = [];
  if (!text || !/x/i.test(text)) return out;
  const segs = String(text).split('|').map((s) => s.trim()).filter(Boolean);
  let rirs = [];
  let block = 0;
  const parseGroups = (seg, type) => {
    let load = null;
    const sets = [];
    for (const tok of seg.split(',')) {
      const m = tok.match(/^\s*(.+?)\s*x\s*(\d+)\s*$/i);
      if (m) { load = parseLoad(m[1]); sets.push({ type, weight: load, reps: Number(m[2]) }); }
      else if (/^\s*\d+\s*$/.test(tok) && load != null) sets.push({ type, weight: load, reps: Number(tok) });
    }
    return sets;
  };
  for (const seg of segs) {
    if (/^rir\b/i.test(seg)) {
      rirs = seg.replace(/^rir/i, '').split(',').map((x) => (/\d/.test(x) ? Number(x.trim()) : null));
    } else if (/^myo\b/i.test(seg)) {
      const m = seg.match(/^myo\s+(.+?)\s*x\s*([\d+\s]+)$/i);
      if (!m) continue;
      const w = parseLoad(m[1]);
      m[2].split('+').map((r) => Number(r.trim())).filter(Number.isFinite).forEach((reps, i) => {
        out.push({ type: i === 0 ? SET.MYO_ACT : SET.MYO_MINI, weight: w, reps, block });
      });
      block++;
    } else if (/^partials?\b/i.test(seg)) {
      out.push(...parseGroups(seg.replace(/^partials?/i, ''), SET.PARTIAL));
    } else {
      out.push(...parseGroups(seg, SET.WORKING));
    }
  }
  let i = 0;
  for (const s of out) {
    s.rir = null;
    if (s.type === SET.WORKING) s.rir = rirs[i++] ?? null;
    s.done = true;
  }
  return out;
}

/**
 * Parse a block copied from the coach's sheet (tab-separated):
 *   <tag> <exercise> <sets> <reps> <RIR> <progression> <rest> <Week 1> <Week 2> ...
 * Header rows have the workout name in column B and "Sets" in column C.
 * A row with no exercise name holds the session time for that week (e.g. 42').
 */
export function parseProgramPaste(text) {
  const workouts = [];
  let cur = null;
  let weekCols = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = raw.split('\t');
    if (norm(c[2]) === 'sets') {
      cur = { name: c[1].trim(), rows: [], durations: {} };
      workouts.push(cur);
      weekCols = [];
      c.forEach((v, i) => {
        const m = String(v).match(/^\s*week\s*(\d+)\s*$/i);
        if (m) weekCols.push([i, Number(m[1])]);
      });
      continue;
    }
    if (!cur) continue;
    const name = (c[1] || '').trim();
    if (!name) {
      for (const [i, w] of weekCols) {
        const m = String(c[i] || '').match(/(\d+)\s*['’′]/) || String(c[i] || '').match(/^\s*(\d+)\s*(min)?\s*$/i);
        if (m) cur.durations[w] = Number(m[1]);
      }
      continue;
    }
    if (/^example/i.test(name)) continue;
    const reps = String(c[3] || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    const weeks = {};
    for (const [i, w] of weekCols) if ((c[i] || '').trim()) weeks[w] = c[i].trim();
    cur.rows.push({
      tag: norm(c[0]).replace(/[^a-z]/g, ''),
      name,
      sets: Number(c[2]) || 2,
      repMin: reps ? Number(reps[1]) : null,
      repMax: reps ? Number(reps[2]) : null,
      rir: (c[4] || '').trim(),
      progression: (c[5] || '').trim(),
      restMin: (c[6] || '').trim(),
      weeks,
    });
  }
  return workouts.filter((w) => w.rows.length);
}

/**
 * Rows of a workout's block in the coach's sheet: every exercise in the templates with that
 * name, interleaved by position across locations, tagged with the location letters.
 */
export function programRows({ workout, templates, locations, exercisesById, session }) {
  const locOrder = [...locations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tpls = templates
    .filter((t) => norm(t.name) === norm(workout))
    .sort((a, b) => locOrder.findIndex((l) => l.id === a.locationId) - locOrder.findIndex((l) => l.id === b.locationId));
  const rows = [];
  const byEx = {};
  const add = (exerciseId, letter, item) => {
    const ex = exercisesById[exerciseId];
    if (!ex) return;
    if (!byEx[exerciseId]) {
      byEx[exerciseId] = {
        exerciseId, name: ex.name, letters: new Set(), sets: item.sets ?? '',
        reps: `${ex.repMin}-${ex.repMax}`, rir: item.rir || '', progression: 'Double', rest: item.restMin || '',
      };
      rows.push(byEx[exerciseId]);
    }
    if (letter) byEx[exerciseId].letters.add(letter);
  };
  const max = Math.max(0, ...tpls.map((t) => t.items.length));
  for (let i = 0; i < max; i++) {
    for (const t of tpls) {
      const it = t.items[i];
      if (!it) continue;
      const loc = locations.find((l) => l.id === t.locationId);
      add(it.exerciseId, loc ? locLetter(loc) : '', it);
    }
  }
  if (session) {
    const loc = locations.find((l) => l.id === session.locationId);
    for (const e of session.exercises) {
      add(e.exerciseId, loc ? locLetter(loc) : '', {
        sets: e.plan?.sets ?? e.sets.filter((s) => s.type === SET.WORKING).length, rir: e.rir, restMin: e.restMin,
      });
    }
  }
  const letterOrder = locOrder.map(locLetter);
  return rows.map(({ letters, ...r }) => ({
    ...r, tag: [...letters].sort((a, b) => letterOrder.indexOf(a) - letterOrder.indexOf(b)).join(''),
  }));
}
