// Read the coach's workbook layout (values as displayed, one 2-D array per tab):
//  - a tab per block: "Block 1", "Block 2"... (block = cycle in the app)
//  - in each tab, a header per workout: <workout> | Sets | Reps | Reps In Reserve | Progression | Rest | Week 1..7
//    with the location tag (h / c / hc) in the column left of the exercise name,
//  - and a separate deload table (often further right, with its own rows): <workout> | Sets | Reps | RIR | Week 8
//  - the session time (e.g. 42') in the row under a table, in that week's column.
// Pure: no browser APIs.
import { norm } from './program.js';

const isSets = (v) => norm(v) === 'sets';

/** Every workout table in a tab: header position, columns, week columns, rows. */
export function findTables(values) {
  const tables = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length - 1; c++) {
      if (!String(row[c] || '').trim() || !isSets(row[c + 1]) || isSets(row[c])) continue;
      const cols = { tag: c - 1, name: c, sets: c + 1 };
      const weeks = {};
      let end = row.length - 1;
      for (let k = c + 2; k < row.length; k++) {
        if (k > c + 2 && isSets(row[k + 1])) { end = k - 1; break; } // the next table starts at k
        const h = norm(row[k]);
        const m = h.match(/^week\s*(\d+)$/);
        if (m) weeks[Number(m[1])] = k;
        else if (h === 'reps') cols.reps = k;
        else if (h.startsWith('reps in reserve') || h === 'rir') cols.rir = k;
        else if (h.startsWith('progression')) cols.progression = k;
        else if (h.startsWith('rest')) cols.rest = k;
      }
      const rows = [];
      let last = r;
      let example = false;
      // rows run down to the next table header in this column; blank rows in between are allowed
      // (deload tables often line up with the main table and leave gaps)
      for (let i = r + 1; i < values.length; i++) {
        const name = String(values[i]?.[c] || '').trim();
        if (isSets(values[i]?.[c + 1])) break;
        if (!name) continue;
        last = i;
        if (/^example/i.test(name)) { example = true; continue; }
        const get = (k) => (k == null || k < 0 ? '' : String(values[i]?.[k] ?? '').trim());
        rows.push({
          r: i, name, tag: get(cols.tag).toLowerCase().replace(/[^a-z]/g, ''),
          sets: Number(get(cols.sets)) || 2, reps: get(cols.reps), rir: get(cols.rir),
          progression: get(cols.progression), rest: get(cols.rest),
        });
      }
      const after = values[last + 1] || [];
      const durations = {};
      if (!String(after[c] || '').trim()) {
        for (const [w, k] of Object.entries(weeks)) {
          const m = String(after[k] || '').match(/^\s*(\d+)\s*['’′]/);
          if (m) durations[w] = Number(m[1]);
        }
      }
      tables.push({ workout: String(row[c]).trim(), header: r, cols, weeks, rows, example, durations, end });
    }
  }
  return tables;
}

const range = (s) => {
  const m = String(s || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  return m ? { repMin: Number(m[1]), repMax: Number(m[2]) } : {};
};

/**
 * One block tab -> the program (from the main tables) and the logged weeks.
 * @returns {{workouts: {name, example, rows}[], logs: {workout, week, values: {name: cell}, tags: {name: tag}, duration}[]}}
 */
export function parseBlockTab(values) {
  const tables = findTables(values);
  const byWorkout = new Map();
  for (const t of tables) {
    if (!byWorkout.has(norm(t.workout))) byWorkout.set(norm(t.workout), { name: t.workout, tables: [] });
    byWorkout.get(norm(t.workout)).tables.push(t);
  }
  const workouts = [];
  const logs = [];
  for (const { name, tables: ts } of byWorkout.values()) {
    // the main table is the one with the most week columns (weeks 1-7); the deload table has week 8
    const main = [...ts].sort((a, b) => Object.keys(b.weeks).length - Object.keys(a.weeks).length)[0];
    workouts.push({
      name, example: main.example,
      rows: main.rows.map((x) => ({
        tag: x.tag, name: x.name, sets: x.sets, ...range(x.reps), reps: x.reps, rir: x.rir, progression: x.progression, rest: x.rest,
      })),
    });
    const weeks = new Map();
    for (const t of ts) {
      for (const [w, k] of Object.entries(t.weeks)) {
        const week = Number(w);
        if (!weeks.has(week)) weeks.set(week, { workout: name, week, values: {}, tags: {}, sets: {}, duration: null });
        const entry = weeks.get(week);
        for (const x of t.rows) {
          const cell = String(values[x.r]?.[k] ?? '').trim();
          if (!cell) continue;
          entry.values[x.name] = cell;
          entry.tags[x.name] = x.tag;
          entry.sets[x.name] = { sets: x.sets, rir: x.rir, rest: x.rest };
        }
        if (t.durations[w]) entry.duration = t.durations[w];
      }
    }
    for (const e of weeks.values()) {
      const names = Object.keys(e.values);
      if (!names.length) continue;
      const single = [...new Set(names.map((n) => e.tags[n]).filter((t) => t && t.length === 1))];
      if (single.length <= 1) { logs.push(e); continue; }
      // values for both locations in one week (the workout was done twice): one log per location,
      // shared (hc) exercises go with the location that has more entries
      const count = (l) => names.filter((n) => e.tags[n] === l).length;
      const main = [...single].sort((x, y) => count(y) - count(x))[0];
      for (const l of single) {
        const pick = names.filter((n) => e.tags[n] === l || (l === main && e.tags[n] !== l && !single.includes(e.tags[n])));
        logs.push({
          ...e, location: l, duration: l === main ? e.duration : null,
          values: Object.fromEntries(pick.map((n) => [n, e.values[n]])),
          tags: Object.fromEntries(pick.map((n) => [n, e.tags[n]])),
          sets: Object.fromEntries(pick.map((n) => [n, e.sets[n]])),
        });
      }
    }
  }
  return { workouts, logs };
}

/** Equipment settings tab: Key | Exercise | Location (H/C) | Settings | Updated */
export function parseSettingsTab(values) {
  const head = (values[0] || []).map(norm);
  const col = (n) => head.indexOf(n);
  const ex = col('exercise');
  const loc = col('location');
  const set = col('settings');
  if (ex < 0 || set < 0) return [];
  return values.slice(1)
    .map((r) => ({ exercise: String(r[ex] || '').trim(), letter: norm(r[loc]).charAt(0), settings: String(r[set] || '').trim() }))
    .filter((x) => x.exercise && x.settings);
}

/** Block number from a tab name ("Block 2" -> 2). */
export const blockNumber = (name) => Number(String(name).match(/^\s*block\s*(\d+)\s*$/i)?.[1]) || null;
