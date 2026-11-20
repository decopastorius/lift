// Tap-to-pick options for logging a set (pure, testable).
import { SET } from './progression.js';

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Nine loads around the current / suggested weight, in steps of the exercise's increment.
 * `shift` moves the window (◀ / ▶ in the picker) by whole windows.
 */
export function weightOptions({ current, suggested, last, increment, bodyweight, shift = 0 }) {
  const step = increment > 0 ? increment : 5;
  const base = current ?? suggested ?? last ?? (bodyweight ? 0 : 20 * step);
  const center = Math.max(4 * step, base + shift * 9 * step);
  const out = [];
  for (let k = -4; k <= 4; k++) {
    const v = r2(center + k * step);
    if (v >= 0) out.push(v);
  }
  return out;
}

/** Reps around the exercise's range (wider for warm-ups, short for myo mini-sets). */
export function repOptions({ repMin = 8, repMax = 12, type }) {
  let lo = Math.max(1, repMin - 4);
  let hi = repMax + 5;
  if (type === SET.MYO_MINI) { lo = 1; hi = 8; }
  if (type === SET.WARMUP) { lo = 3; hi = Math.max(15, repMax); }
  if (type === SET.MYO_ACT) hi = Math.max(hi, 20);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export const RIR_OPTIONS = [0, 1, 2, 3, 4, 5];

/** Notes are stored as "a; b; free text" so preset chips can be toggled. */
export const splitNotes = (v) => String(v || '').split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const hasNote = (value, preset) => splitNotes(value).some((x) => same(x, preset));
export function toggleNote(value, preset) {
  const parts = splitNotes(value);
  return (hasNote(value, preset) ? parts.filter((x) => !same(x, preset)) : [...parts, preset]).join('; ');
}

export const DEFAULT_NOTE_PRESETS = {
  exercise: [
    'Felt easy', 'Felt heavy', 'Form broke down on last set', 'Pain / discomfort', 'Unilateral', 'Bilateral',
    'Grip was limiting', 'Shortened rest', 'Equipment substituted', 'Paused reps',
  ],
  session: [
    'Great session', 'Felt strong', 'Low energy', 'Poor sleep', 'Short on time', 'Sore from last session', 'Stressful day',
  ],
};
