// First-run data. Everything here is editable in the app.
import { uid } from './util.js';
import { PROGRAM, norm, locLetter } from './program.js';

export function seedLocations() {
  return ['Home', 'Cottage', 'Travel'].map((name, i) => ({ id: uid(), name, order: i, equipment: '' }));
}

// Starting library: the program's exercises, named exactly as in the coach's sheet
// (the sheet export finds each exercise's row by name).
// [name, category, repMin, repMax, increment(lb), bodyweight, notes]
// Rep ranges per the coach: compounds 8–10, deadlift & RDL 6–8, isolation 10–15.
const LIST = [
  ['Chest Supported DB Row', 'Back', 8, 10, 5, false, 'Weight = per dumbbell.'],
  ['Seated Row (cable)', 'Back', 8, 10, 5],
  ['Cable Pull-Downs (neutral grip)', 'Back', 8, 10, 5],
  ['Pull-Ups/Chin-Ups', 'Back', 8, 10, 5, true, 'Weight = added load (belt/vest). Note grip in exercise notes.'],
  ['DB Bench Press (horizontal)', 'Chest', 8, 10, 5, false, 'Weight = per dumbbell.'],
  ['Barbell Bench Press (horizontal)', 'Chest', 8, 10, 5],
  ['Incline DB Press (15-30°)', 'Chest', 8, 10, 5, false, 'Weight = per dumbbell.'],
  ['Incline Barbell Press (15-30°)', 'Chest', 8, 10, 5],
  ['Lateral (DB)', 'Shoulders', 10, 15, 5],
  ['Lateral (cable)', 'Shoulders', 10, 15, 5],
  ['Skullcrucher DB', 'Arms', 10, 15, 5],
  ['Cable Pressdown (rope)', 'Arms', 10, 15, 5],
  ['Standing Curl (DB / bilateral or unilateral)', 'Arms', 10, 15, 5, false, 'Weight = per dumbbell.'],
  ['Split Squat (Smith Machine)', 'Legs', 8, 10, 5],
  ['Split Squat (DB)', 'Legs', 8, 10, 5, false, 'Weight = per dumbbell.'],
  ['RDL (Romanian Deadlift / DB / bilateral or unilateral)', 'Legs', 6, 8, 5, false, 'Weight = per dumbbell.'],
  ['Deadlift (conventional)', 'Legs', 6, 8, 10],
  ['Seated Leg Curl (machine)', 'Legs', 10, 15, 5],
  ['Leg Extension', 'Legs', 10, 15, 5],
  ['Ab Exercise of Choice', 'Core', 10, 15, 5, true, 'Write which exercise you did in the exercise notes.'],
];

export function seedExercises() {
  return LIST.map(([name, category, repMin, repMax, increment, bodyweight, notes]) => newExercise({
    name, category, repMin, repMax, increment, bodyweight: !!bodyweight, notes: notes || '',
    compound: repMax <= 10, // compounds are 8–10 / 6–8 in this program; isolation 10–15
  }));
}

/** One template per workout per location (Upper 1 at Home, Upper 1 at the Cottage, ...). */
export function seedTemplates(locations, exercises) {
  const exByName = Object.fromEntries(exercises.map((e) => [norm(e.name), e]));
  const out = [];
  for (const w of PROGRAM) {
    for (const loc of locations) {
      const letter = locLetter(loc);
      const items = w.rows
        .filter(([tag, name]) => tag.includes(letter) && exByName[norm(name)])
        .map(([, name, sets, rir, restMin]) => ({
          id: uid(), exerciseId: exByName[norm(name)].id, warmups: 0, sets, myo: 0, partials: 0,
          restMin, rir, group: '',
        }));
      if (items.length) out.push({ id: uid(), name: w.name, locationId: loc.id, items, createdAt: Date.now() });
    }
  }
  return out;
}

export function newExercise(fields = {}) {
  return {
    id: uid(),
    name: '',
    category: '',
    repMin: 8,
    repMax: 12,
    increment: 5,
    bodyweight: false,
    notes: '',
    setups: {}, // locationId | 'any' -> { equipment, settings }
    createdAt: Date.now(),
    ...fields,
  };
}

/**
 * Parse a pasted list, one exercise per line:
 *   Name, Category, 8-12, 5, bw
 * Only the name is required. Separators: comma, tab, semicolon or |.
 */
export function parseExerciseList(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s*[,\t;|]\s*/);
    const f = { name: parts[0] };
    for (const p of parts.slice(1)) {
      const range = p.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) { f.repMin = +range[1]; f.repMax = +range[2]; continue; }
      if (/^(bw|bodyweight)$/i.test(p)) { f.bodyweight = true; continue; }
      if (/^\d+(\.\d+)?$/.test(p)) { f.increment = +p; continue; }
      if (p && !f.category) f.category = p;
    }
    if (f.name) out.push(f);
  }
  return out;
}
