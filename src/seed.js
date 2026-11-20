// First-run data. Everything here is editable in the app.
import { uid } from './util.js';

export function seedLocations() {
  return ['Home', 'Cottage', 'Travel'].map((name, i) => ({ id: uid(), name, order: i, equipment: '' }));
}

// [name, category, repMin, repMax, increment(lb), bodyweight]
const LIST = [
  ['Barbell Bench Press', 'Chest', 6, 10, 5],
  ['Dumbbell Bench Press', 'Chest', 8, 12, 5],
  ['Incline Dumbbell Press', 'Chest', 8, 12, 5],
  ['Push-up', 'Chest', 10, 20, 5, true],
  ['Dip', 'Chest', 6, 12, 5, true],
  ['Cable Fly', 'Chest', 10, 15, 5],
  ['Overhead Press', 'Shoulders', 6, 10, 5],
  ['Dumbbell Shoulder Press', 'Shoulders', 8, 12, 5],
  ['Lateral Raise', 'Shoulders', 12, 20, 2.5],
  ['Rear Delt Fly', 'Shoulders', 12, 20, 2.5],
  ['Pull-up', 'Back', 6, 10, 5, true],
  ['Chin-up', 'Back', 6, 10, 5, true],
  ['Lat Pulldown', 'Back', 8, 12, 5],
  ['One-arm Dumbbell Row', 'Back', 8, 12, 5],
  ['Chest-supported Row', 'Back', 8, 12, 5],
  ['Seated Cable Row', 'Back', 8, 12, 5],
  ['Inverted Row', 'Back', 8, 15, 5, true],
  ['Back Squat', 'Legs', 5, 8, 5],
  ['Goblet Squat', 'Legs', 8, 15, 5],
  ['Bulgarian Split Squat', 'Legs', 8, 12, 5],
  ['Leg Press', 'Legs', 10, 15, 10],
  ['Romanian Deadlift', 'Legs', 6, 10, 5],
  ['Deadlift', 'Legs', 3, 6, 10],
  ['Hip Thrust', 'Legs', 8, 12, 10],
  ['Leg Curl', 'Legs', 10, 15, 5],
  ['Leg Extension', 'Legs', 10, 15, 5],
  ['Standing Calf Raise', 'Legs', 10, 15, 5],
  ['Dumbbell Curl', 'Arms', 8, 12, 2.5],
  ['Incline Dumbbell Curl', 'Arms', 8, 12, 2.5],
  ['Hammer Curl', 'Arms', 8, 12, 2.5],
  ['Cable Triceps Pushdown', 'Arms', 10, 15, 5],
  ['Overhead Triceps Extension', 'Arms', 10, 15, 2.5],
  ['Skull Crusher', 'Arms', 8, 12, 5],
  ['Hanging Leg Raise', 'Core', 8, 15, 5, true],
  ['Cable Crunch', 'Core', 10, 15, 5],
  ['Plank (seconds)', 'Core', 30, 60, 5, true],
];

export function seedExercises() {
  return LIST.map(([name, category, repMin, repMax, increment, bodyweight]) => newExercise({
    name, category, repMin, repMax, increment, bodyweight: !!bodyweight,
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
