// Import a block pasted from the coach's sheet: exercises (rep ranges), templates per
// location (from the h/c tags), and past weeks as finished workouts (history for progression).
// Pure: returns what to save; the caller saves it.
import { parseProgramPaste, parseLog, norm, locLetter, restSeconds, weekStartTs, weekNumber } from './program.js';
import { newExercise } from './seed.js';
import { uid } from './util.js';

export function planImport(text, { locations, exercises, templates, sessions }, programStart) {
  const workouts = parseProgramPaste(text);
  const warnings = [];
  const exByName = Object.fromEntries(exercises.map((e) => [norm(e.name), e]));
  const exChanged = new Map();
  const getEx = (row) => {
    const key = norm(row.name);
    let ex = exByName[key];
    const range = row.repMin && row.repMax ? { repMin: row.repMin, repMax: row.repMax } : {};
    if (!ex) ex = newExercise({ name: row.name, ...range });
    else if (range.repMin && (range.repMin !== ex.repMin || range.repMax !== ex.repMax)) ex = { ...ex, ...range };
    else return ex;
    exByName[key] = ex;
    exChanged.set(ex.id, ex);
    return ex;
  };
  const letterLoc = Object.fromEntries(locations.map((l) => [locLetter(l), l]));
  const allLetters = Object.keys(letterLoc).join('');
  const outTemplates = [];
  const outSessions = [];

  workouts.forEach((w, wi) => {
    const rows = w.rows.map((r) => ({ ...r, tag: r.tag || allLetters, ex: getEx(r) }));

    for (const letter of [...new Set(rows.flatMap((r) => r.tag.split('')))]) {
      const loc = letterLoc[letter];
      if (!loc) { warnings.push(`${w.name}: no location starting with “${letter.toUpperCase()}”, rows skipped.`); continue; }
      const items = rows.filter((r) => r.tag.includes(letter)).map((r) => ({
        id: uid(), exerciseId: r.ex.id, warmups: 0, sets: r.sets, myo: 0, partials: 0,
        rest: restSeconds(r.restMin), restMin: r.restMin, rir: r.rir, group: '',
      }));
      const existing = templates.find((t) => norm(t.name) === norm(w.name) && t.locationId === loc.id);
      outTemplates.push(existing ? { ...existing, items } : { id: uid(), name: w.name, locationId: loc.id, items, createdAt: Date.now() });
    }

    const weeks = [...new Set(rows.flatMap((r) => Object.keys(r.weeks).map(Number)))].sort((a, b) => a - b);
    for (const week of weeks) {
      const key = `${norm(w.name)}|${week}`;
      const already = sessions.some((s) => s.importKey === key
        || (s.status === 'done' && norm(s.name) === norm(w.name) && weekNumber(s.startedAt, programStart) === week));
      if (already) continue;
      const done = rows.filter((r) => r.weeks[week]);
      const counts = {};
      for (const r of done) if (r.tag.length === 1) counts[r.tag] = (counts[r.tag] || 0) + 1;
      const letter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || done[0]?.tag[0];
      const loc = letterLoc[letter] || locations[0];
      const startedAt = weekStartTs(programStart, week, wi * 2);
      const exs = [];
      for (const r of done) {
        const parsed = parseLog(r.weeks[week]);
        if (!parsed.length) { warnings.push(`${w.name} week ${week}: couldn’t read “${r.weeks[week]}” for ${r.name}.`); continue; }
        exs.push({
          id: uid(), exerciseId: r.ex.id, group: '', rest: restSeconds(r.restMin), rir: r.rir, restMin: r.restMin,
          plan: { warmups: 0, sets: r.sets, myo: 0, partials: 0 },
          sets: parsed.map((s) => ({ id: uid(), target: null, block: 0, completedAt: startedAt, restBefore: null, ...s })),
          notes: '', suggestion: null,
        });
      }
      if (!exs.length) continue;
      const tpl = outTemplates.find((t) => norm(t.name) === norm(w.name) && t.locationId === loc?.id);
      const minutes = w.durations[week];
      outSessions.push({
        id: uid(), status: 'done', importKey: key, templateId: tpl?.id || null, name: w.name,
        locationId: loc?.id || null, startedAt, endedAt: startedAt + (minutes ? minutes * 60000 : 0),
        lastSetAt: null, restTarget: null, restLabel: '', notes: `Imported from the coach's sheet (week ${week}).`,
        syncState: 'synced', // it is already in the sheet
        exercises: exs,
      });
    }
  });

  return { workouts, exercises: [...exChanged.values()], templates: outTemplates, sessions: outSessions, warnings };
}
