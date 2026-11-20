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
    example: true, // the sheet has an "Example for Logging Data" row under this header
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

/** The sheet layout the app starts with: blocks of rows, in the sheet's order. */
export function defaultLayout() {
  return PROGRAM.map((w) => ({
    name: w.name,
    example: !!w.example,
    rows: w.rows.map(([tag, name, sets, rir, rest]) => ({ tag, name, sets, reps: '', rir, rest })),
  }));
}

/**
 * The coach's "Week N" of a workout. A week is one round of the program (Upper 1, Lower 1,
 * Upper 2...), so it's stored on each workout; older ones without it count occurrences.
 */
export function weekOf(session, sessions = []) {
  if (Number.isFinite(session.week)) return session.week;
  return 1 + sessions.filter((s) => s.status === 'done' && s.id !== session.id
    && norm(s.name) === norm(session.name) && s.startedAt < session.startedAt).length;
}

export const cycleOf = (session) => session.cycle || 1;

/**
 * Where the next workout with this name falls: the week after the most recent one, wrapping to
 * week 1 of the next cycle after the last (deload) week.
 */
export function nextSlot(name, sessions, cycleWeeks = 8) {
  const done = sessions
    .filter((s) => s.status === 'done' && norm(s.name) === norm(name))
    .sort((a, b) => a.startedAt - b.startedAt);
  const last = done.at(-1);
  if (!last) return { week: 1, cycle: 1, deload: cycleWeeks === 1 };
  const w = weekOf(last, sessions);
  const slot = w >= cycleWeeks ? { week: 1, cycle: cycleOf(last) + 1 } : { week: w + 1, cycle: cycleOf(last) };
  return { ...slot, deload: slot.week === cycleWeeks };
}

/** Week number for the next workout with this name. */
export function nextWeek(name, sessions, cycleWeeks = 8) {
  return nextSlot(name, sessions, cycleWeeks).week;
}

/** Noon, `daysBefore` days before a YYYY-MM-DD date. */
export function dayTs(date, daysBefore = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d - daysBefore, 12).getTime();
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
  const own = partials.filter((s) => !s.afterFailure);
  const after = partials.filter((s) => s.afterFailure);
  if (own.length) parts.push(`Partials ${groupByLoad(own, bodyweight)}`);
  if (after.length) parts.push(`Partials (after failure) ${groupByLoad(after, bodyweight)}`);
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
      const after = /\(after failure\)/i.test(seg);
      const sets = parseGroups(seg.replace(/^partials?/i, '').replace(/\(after failure\)/i, ''), SET.PARTIAL);
      if (after) for (const x of sets) { x.partialMode = 'after'; x.afterFailure = true; }
      out.push(...sets);
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
    if (/^example/i.test(name)) { cur.example = true; continue; }
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

const LOG_KIND = (v) => {
  if (!v) return 'empty';
  if (/^\d+\s*(['’′]|min\b)/i.test(v)) return 'duration';
  if (/^load\b/i.test(v)) return 'example';
  return parseLog(v).length ? 'log' : 'other';
};

/**
 * Parse a single week column copied from the sheet (values only, one per line, blank lines for
 * empty cells, "Week N" where a block header was). Values are lined up with the layout's rows;
 * where several alignments are possible, the one whose filled rows share a location tag wins.
 */
export function parseColumnPaste(text, layout) {
  const lines = String(text).split(/\r?\n/).map((l) => l.split('\t')[0].trim());
  const segs = [];
  let cur = { week: null, lines: [] };
  for (const l of lines) {
    const m = l.match(/^week\s*(\d+)$/i);
    if (m) { segs.push(cur); cur = { week: Number(m[1]), lines: [] }; } else cur.lines.push(l);
  }
  segs.push(cur);
  if (!segs[0].lines.some(Boolean)) segs.shift();
  const headerWeek = segs.find((x) => x.week != null)?.week ?? null;
  const warnings = [];
  const blocks = [];
  segs.forEach((seg, i) => {
    const w = layout[i];
    if (!w) {
      if (seg.lines.some(Boolean)) warnings.push(`The paste has more blocks than the program (${layout.length}); the rest was ignored.`);
      return;
    }
    const ls = [...seg.lines];
    while (ls.length && !ls.at(-1)) ls.pop();
    const slots = [...(w.example ? [{ kind: 'example' }] : []), ...w.rows.map((row) => ({ kind: 'log', row })), { kind: 'duration' }];
    while (ls.length > slots.length && !ls[0]) ls.shift();
    const kinds = ls.map(LOG_KIND);
    if (kinds.includes('other')) {
      warnings.push(`${w.name}: couldn’t read “${ls[kinds.indexOf('other')]}”.`);
      return;
    }
    const fits = [];
    for (let o = 0; o + ls.length <= slots.length; o++) {
      if (!kinds.every((k, j) => k === 'empty' || k === slots[o + j].kind)) continue;
      const tags = kinds.map((k, j) => (k === 'log' ? slots[o + j].row.tag || '' : null)).filter((t) => t != null);
      const consistent = !tags.length || [...'abcdefghijklmnopqrstuvwxyz'].some((c) => tags.every((t) => !t || t.includes(c)));
      fits.push({ o, consistent });
    }
    const good = fits.filter((f) => f.consistent);
    const pool = good.length ? good : fits;
    if (!pool.length || !kinds.includes('log')) {
      if (kinds.includes('log')) warnings.push(`${w.name}: couldn’t line the values up with the exercises.`);
      return;
    }
    if (pool.length > 1) warnings.push(`${w.name}: the values could line up more than one way. Check the preview.`);
    const { o } = seg.week != null ? pool[0] : pool.at(-1); // under a header: from the top; else from the bottom
    const values = {};
    let duration = null;
    ls.forEach((v, j) => {
      const slot = slots[o + j];
      if (v && slot.kind === 'log') values[slot.row.name] = v;
      if (v && slot.kind === 'duration') duration = parseInt(v, 10);
    });
    blocks.push({ workout: w.name, week: seg.week ?? headerWeek, values, duration });
  });
  return { blocks, warnings };
}
