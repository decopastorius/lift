// First-run data. Everything here is editable in the app.
import { uid } from './util.js';

export function seedLocations() {
  return ['Home', 'Cottage', 'Travel'].map((name, i) => ({ id: uid(), name, order: i, equipment: '' }));
}

// Starting library: the exercises currently in the program.
// [name, category, repMin, repMax, increment(lb), bodyweight, notes]
// Rep ranges per the coach: compounds 8–10, deadlift 6–8, isolation 10–15.
const LIST = [
  ['Chest Supported DB Row', 'Back', 8, 10, 5],
  ['Seated Row (cable)', 'Back', 8, 10, 5],
  ['Cable Pull-Down (neutral grip)', 'Back', 8, 10, 5],
  ['Pull-Ups / Chin-Ups', 'Back', 8, 10, 5, true, 'Weight = added load (belt/vest). Note grip in set notes.'],
  ['DB Bench Press (horizontal)', 'Chest', 8, 10, 5],
  ['Barbell Bench Press (horizontal)', 'Chest', 8, 10, 5],
  ['Incline DB Press (15-30°)', 'Chest', 8, 10, 5],
  ['Incline Barbell Press (15-30°)', 'Chest', 8, 10, 5],
  ['Lateral Raise (DB)', 'Shoulders', 10, 15, 5],
  ['Lateral Raise (cable)', 'Shoulders', 10, 15, 5],
  ['Skullcrusher (DB)', 'Arms', 10, 15, 5],
  ['Cable Pressdown (rope)', 'Arms', 10, 15, 5],
  ['Standing Curl (DB)', 'Arms', 10, 15, 5, false, 'Bilateral or unilateral. Weight = per dumbbell.'],
  ['Split Squat (Smith Machine)', 'Legs', 8, 10, 5],
  ['Split Squat (DB)', 'Legs', 8, 10, 5, false, 'Weight = per dumbbell.'],
  ['RDL (DB)', 'Legs', 8, 12, 5, false, 'Romanian deadlift. Bilateral or unilateral. Weight = per dumbbell.'],
  ['Deadlift (conventional)', 'Legs', 6, 8, 10],
  ['Seated Leg Curl (machine)', 'Legs', 10, 15, 5],
  ['Leg Extension', 'Legs', 10, 15, 5],
  ['Ab Exercise (of choice)', 'Core', 10, 15, 5, true, 'Write which exercise you did in the exercise notes.'],
];

export function seedExercises() {
  return LIST.map(([name, category, repMin, repMax, increment, bodyweight, notes]) => newExercise({
    name, category, repMin, repMax, increment, bodyweight: !!bodyweight, notes: notes || '',
  }));
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
