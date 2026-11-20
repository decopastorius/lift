// Import from the coach's sheet. Two kinds of paste:
//  - the full program (header rows "Upper 1 | Sets | Reps ..." + week columns): updates the
//    sheet layout, exercises, rep ranges and templates, and imports every week as history;
//  - a single week column (values only): lined up with the current layout and imported as history.
// Pure: returns what to save; the caller saves it.
import {
  parseProgramPaste, parseColumnPaste, parseLog, norm, locLetter, restSeconds, dayTs, weekOf,
} from './program.js';
import { newExercise } from './seed.js';
import { parseBlockTab, parseSettingsTab, blockNumber } from './coachsheet.js';
import { uid } from './util.js';

/**
 * @param text the paste
 * @param data {locations, exercises, templates, sessions}
 * @param opts {layout, lastDate: 'YYYY-MM-DD' of the last workout in the paste, week: used when the paste has no "Week N"}
 */
export function planImport(text, { locations, exercises, templates, sessions }, { layout, lastDate, week: fallbackWeek = null, cycleWeeks = 8 }) {
  const warnings = [];
  const exByName = Object.fromEntries(exercises.map((e) => [norm(e.name), e]));
  const exChanged = new Map();
  const getEx = (name, range = {}) => {
    const key = norm(name);
    let ex = exByName[key];
    if (!ex) ex = newExercise({ name, ...range });
    else if (range.repMin && (range.repMin !== ex.repMin || range.repMax !== ex.repMax)) ex = { ...ex, ...range };
    else return ex;
    exByName[key] = ex;
    exChanged.set(ex.id, ex);
    return ex;
  };
  const letterLoc = Object.fromEntries(locations.map((l) => [locLetter(l), l]));
  const allLetters = Object.keys(letterLoc).join('');

  const workouts = parseProgramPaste(text);
  const mode = workouts.length ? 'program' : 'column';
  let newLayout = null;
  let blocks;
  const outTemplates = [];

  if (mode === 'program') {
    newLayout = workouts.map((w) => ({
      name: w.name,
      example: !!w.example,
      rows: w.rows.map((r) => ({
        tag: r.tag || allLetters, name: r.name, sets: r.sets,
        reps: r.repMin ? `${r.repMin}-${r.repMax}` : '', rir: r.rir, rest: r.restMin,
      })),
    }));
    for (const w of workouts) {
      const rows = w.rows.map((r) => ({ ...r, tag: r.tag || allLetters, ex: getEx(r.name, r.repMin ? { repMin: r.repMin, repMax: r.repMax } : {}) }));
      for (const letter of [...new Set(rows.flatMap((r) => r.tag.split('')))]) {
        const loc = letterLoc[letter];
        if (!loc) { warnings.push(`${w.name}: no location starting with “${letter.toUpperCase()}”, those rows were skipped.`); continue; }
        const items = rows.filter((r) => r.tag.includes(letter)).map((r) => ({
          id: uid(), exerciseId: r.ex.id, warmups: 0, sets: r.sets, myo: 0, partials: 0,
          restMin: r.restMin, rir: r.rir, group: '',
        }));
        const existing = templates.find((t) => norm(t.name) === norm(w.name) && t.locationId === loc.id);
        outTemplates.push(existing ? { ...existing, items } : { id: uid(), name: w.name, locationId: loc.id, items, createdAt: Date.now() });
      }
    }
    blocks = workouts.flatMap((w) => {
      const weeks = [...new Set(w.rows.flatMap((r) => Object.keys(r.weeks).map(Number)))];
      return weeks.map((wk) => ({
        workout: w.name, week: wk, duration: w.durations[wk] || null,
        values: Object.fromEntries(w.rows.filter((r) => r.weeks[wk]).map((r) => [r.name, r.weeks[wk]])),
      }));
    });
  } else {
    const col = parseColumnPaste(text, layout);
    warnings.push(...col.warnings);
    blocks = col.blocks;
  }

  const useLayout = newLayout || layout;
  const idxOf = (name) => useLayout.findIndex((b) => norm(b.name) === norm(name));
  const missingWeek = blocks.some((b) => b.week == null);
  for (const b of blocks) if (b.week == null) b.week = fallbackWeek;
  const dated = blocks.filter((b) => b.week != null);
  const maxWeek = Math.max(0, ...dated.map((b) => b.week));
  const lastIdx = Math.max(0, ...dated.filter((b) => b.week === maxWeek).map((b) => idxOf(b.workout)));

  const outSessions = [];
  for (const b of dated) {
    const key = `${norm(b.workout)}|${b.week}`;
    if (sessions.some((s) => s.importKey === key
      || (s.status === 'done' && norm(s.name) === norm(b.workout) && weekOf(s, sessions) === b.week))) continue;
    const block = useLayout[idxOf(b.workout)];
    const tagOf = (name) => block?.rows.find((r) => norm(r.name) === norm(name))?.tag || '';
    const rowOf = (name) => block?.rows.find((r) => norm(r.name) === norm(name)) || {};
    const counts = {};
    for (const name of Object.keys(b.values)) { const t = tagOf(name); if (t.length === 1) counts[t] = (counts[t] || 0) + 1; }
    const letter = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] || tagOf(Object.keys(b.values)[0])[0];
    const loc = letterLoc[letter] || locations[0];
    const startedAt = dayTs(lastDate, (maxWeek - b.week) * 7 + (lastIdx - idxOf(b.workout)) * 2);
    const exs = [];
    for (const [name, cell] of Object.entries(b.values)) {
      const parsed = parseLog(cell);
      if (!parsed.length) { warnings.push(`${b.workout} week ${b.week}: couldn’t read “${cell}” for ${name}.`); continue; }
      const r = rowOf(name);
      const ex = getEx(name);
      exs.push({
        id: uid(), exerciseId: ex.id, group: '', rest: restSeconds(r.rest), rir: r.rir || '', restMin: r.rest || '',
        plan: { warmups: 0, sets: r.sets || parsed.length, myo: 0, partials: 0 },
        sets: parsed.map((x) => ({ id: uid(), target: null, completedAt: startedAt, restBefore: null, block: 0, ...x })),
        notes: '', suggestion: null,
      });
    }
    if (!exs.length) continue;
    const tpl = [...outTemplates, ...templates].find((t) => norm(t.name) === norm(b.workout) && t.locationId === loc?.id);
    outSessions.push({
      id: uid(), status: 'done', importKey: key, week: b.week, cycle: 1, deload: b.week === cycleWeeks, templateId: tpl?.id || null, name: block?.name || b.workout,
      locationId: loc?.id || null, startedAt, endedAt: startedAt + (b.duration ? b.duration * 60000 : 0),
      lastSetAt: null, restTarget: null, restLabel: '', notes: `Imported from the coach's sheet (week ${b.week}).`,
      syncState: 'synced', // already in the sheet
      exercises: exs,
    });
  }
  outSessions.sort((a, b2) => a.startedAt - b2.startedAt);

  return {
    mode, missingWeek, layout: newLayout, workouts,
    exercises: [...exChanged.values()], templates: outTemplates, sessions: outSessions, warnings,
  };
}

/**
 * Import straight from the coach's workbook (read through the Apps Script):
 *  - every "Block N" tab becomes cycle N of history (weeks 1–7 + the week-8 deload),
 *  - the latest block defines the program: sheet layout, rep ranges, templates per location,
 *  - the equipment-settings tab pre-fills each exercise's setup per location.
 * Workouts imported before are replaced, so it can be run again at any time.
 * @param book {tabs: {"Block 1": string[][], ...}, settings: string[][]}
 */
export function planWorkbookImport(book, { locations, exercises, templates, sessions }, { lastDate, cycleWeeks = 8 }) {
  const warnings = [];
  const blocks = Object.entries(book.tabs || {})
    .map(([name, values]) => ({ name, cycle: blockNumber(name), ...parseBlockTab(values) }))
    .filter((b) => b.cycle)
    .sort((a, b) => a.cycle - b.cycle);
  if (!blocks.length) return { blocks: [], warnings: ['No "Block N" tabs found in the sheet.'], exercises: [], templates: [], sessions: [], removeIds: [], layout: null, setups: 0 };
  const latest = blocks.at(-1);

  const exByName = Object.fromEntries(exercises.map((e) => [norm(e.name), e]));
  const changed = new Map();
  const touch = (ex) => { exByName[norm(ex.name)] = ex; changed.set(ex.id, ex); return ex; };
  const rangeOf = {};
  for (const b of blocks) for (const w of b.workouts) for (const r of w.rows) if (r.repMin) rangeOf[norm(r.name)] = { repMin: r.repMin, repMax: r.repMax };
  const getEx = (name) => {
    const k = norm(name);
    const range = rangeOf[k] || {};
    const ex = exByName[k];
    if (!ex) return touch(newExercise({ name, ...range }));
    if (range.repMin && (range.repMin !== ex.repMin || range.repMax !== ex.repMax)) return touch({ ...ex, ...range });
    return ex;
  };
  const letterLoc = Object.fromEntries(locations.map((l) => [locLetter(l), l]));
  const allLetters = Object.keys(letterLoc).join('');

  // program = the latest block's main tables
  const layout = latest.workouts.map((w) => ({
    name: w.name, example: w.example,
    rows: w.rows.map((r) => ({ tag: r.tag || allLetters, name: r.name, sets: r.sets, reps: r.reps, rir: r.rir, rest: r.rest })),
  }));
  const outTemplates = [];
  for (const w of layout) {
    for (const letter of [...new Set(w.rows.flatMap((r) => r.tag.split('')))]) {
      const loc = letterLoc[letter];
      if (!loc) { warnings.push(`${w.name}: no location starting with “${letter.toUpperCase()}”, those rows were skipped.`); continue; }
      const items = w.rows.filter((r) => r.tag.includes(letter)).map((r) => ({
        id: uid(), exerciseId: getEx(r.name).id, warmups: 0, sets: r.sets, myo: 0, partials: 0, restMin: r.rest, rir: r.rir, group: '',
      }));
      const existing = templates.find((t) => norm(t.name) === norm(w.name) && t.locationId === loc.id);
      outTemplates.push(existing ? { ...existing, items } : { id: uid(), name: w.name, locationId: loc.id, items, createdAt: Date.now() });
    }
  }

  // history: every logged week of every block, dated back from the last workout
  const order = (name) => Math.max(0, layout.findIndex((w) => norm(w.name) === norm(name)));
  const logs = blocks.flatMap((b) => b.logs.map((l) => ({ ...l, cycle: b.cycle })))
    .map((l) => ({ ...l, g: (l.cycle - 1) * cycleWeeks + l.week, idx: order(l.workout) * 2 + (l.location && l.location !== 'h' ? 1 : 0) }))
    .sort((a, b) => a.g - b.g || a.idx - b.idx);
  const lastG = logs.at(-1)?.g ?? 0;
  const lastIdx = Math.max(0, ...logs.filter((l) => l.g === lastG).map((l) => l.idx));
  const outSessions = [];
  for (const l of logs) {
    const names = Object.keys(l.values);
    const counts = {};
    for (const n of names) if (l.tags[n]?.length === 1) counts[l.tags[n]] = (counts[l.tags[n]] || 0) + 1;
    const letter = l.location || Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || (l.tags[names[0]] || '')[0];
    const loc = letterLoc[letter] || locations[0];
    const startedAt = dayTs(lastDate, (lastG - l.g) * 7 + Math.round((lastIdx - l.idx) * 1));
    const deload = l.week === cycleWeeks;
    const exs = [];
    for (const name of names) {
      const parsed = parseLog(l.values[name]);
      if (!parsed.length) { warnings.push(`Block ${l.cycle} ${l.workout} week ${l.week}: couldn’t read “${l.values[name]}” for ${name}.`); continue; }
      const info = l.sets[name] || {};
      exs.push({
        id: uid(), exerciseId: getEx(name).id, group: '', rir: info.rir || '', restMin: info.rest || '',
        plan: { warmups: 0, sets: info.sets || parsed.length, myo: 0, partials: 0 },
        sets: parsed.map((x) => ({ id: uid(), target: null, completedAt: startedAt, restBefore: null, block: 0, ...x })),
        notes: '', suggestion: null,
      });
    }
    if (!exs.length) continue;
    const tpl = [...outTemplates, ...templates].find((t) => norm(t.name) === norm(l.workout) && t.locationId === loc?.id);
    outSessions.push({
      id: uid(), status: 'done', importKey: `${l.cycle}|${norm(l.workout)}|${l.week}|${letter}`,
      cycle: l.cycle, week: l.week, deload, templateId: tpl?.id || null, name: l.workout, locationId: loc?.id || null,
      startedAt, endedAt: startedAt + (l.duration ? l.duration * 60000 : 0), lastSetAt: null, restTarget: null, restLabel: '',
      notes: `Imported from the coach's sheet (Block ${l.cycle}, week ${l.week}).`, syncState: 'synced', exercises: exs,
    });
  }

  // equipment settings -> exercise setups per location
  let setups = 0;
  for (const s of parseSettingsTab(book.settings || [])) {
    const loc = letterLoc[s.letter];
    if (!loc) continue;
    const ex = getEx(s.exercise);
    const prev = ex.setups?.[loc.id] || {};
    if (prev.settings === s.settings) continue;
    touch({ ...ex, setups: { ...(ex.setups || {}), [loc.id]: { equipment: prev.equipment || '', settings: s.settings } } });
    setups++;
  }

  return {
    blocks: blocks.map((b) => ({ name: b.name, cycle: b.cycle, weeks: [...new Set(b.logs.map((l) => l.week))].sort((x, y) => x - y) })),
    layout, exercises: [...changed.values()], templates: outTemplates, sessions: outSessions, setups,
    removeIds: sessions.filter((s) => s.importKey).map((s) => s.id), warnings,
  };
}
