// In-memory app state mirrored to IndexedDB. Writes are debounced per record.
import * as db from './db.js';
import { DEFAULT_SETTINGS } from './session-logic.js';
import { seedLocations, seedExercises } from './seed.js';

export const state = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  locations: [],
  exercises: [],
  templates: [],
  sessions: [],
  sync: { busy: false, lastError: '', lastAt: null },
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit() {
  for (const fn of listeners) fn();
}

export async function load() {
  const [kv, locations, exercises, templates, sessions] = await Promise.all(
    ['kv', 'locations', 'exercises', 'templates', 'sessions'].map(db.getAll),
  );
  const settings = kv.find((r) => r.id === 'settings');
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.locations = locations;
  state.exercises = exercises;
  state.templates = templates;
  state.sessions = sessions;
  if (!settings) {
    // first run
    state.locations = seedLocations();
    state.exercises = seedExercises();
    await db.put('kv', state.settings);
    for (const l of state.locations) await db.put('locations', l);
    for (const e of state.exercises) await db.put('exercises', e);
  }
  state.ready = true;
  emit();
}

const timers = new Map();
const pending = new Map();
function schedule(store, obj, delay) {
  const key = store + ':' + obj.id;
  pending.set(key, [store, obj]);
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => flushKey(key), delay));
}
function flushKey(key) {
  const p = pending.get(key);
  if (!p) return Promise.resolve();
  pending.delete(key);
  timers.delete(key);
  return db.put(p[0], p[1]).catch((e) => console.error('save failed', e));
}
export function flush() {
  return Promise.all([...pending.keys()].map(flushKey));
}

/** Insert or replace a record. `delay` > 0 debounces the disk write (used while typing). */
export function save(store, obj, delay = 0) {
  if (store === 'kv') {
    state.settings = obj;
  } else {
    const list = state[store];
    const i = list.findIndex((x) => x.id === obj.id);
    if (i >= 0) list[i] = obj; else list.push(obj);
    state[store] = [...list];
  }
  emit();
  schedule(store, obj, delay);
}

export async function remove(store, id) {
  state[store] = state[store].filter((x) => x.id !== id);
  emit();
  pending.delete(store + ':' + id);
  await db.del(store, id);
}

export function saveSettings(patch) {
  save('kv', { ...state.settings, ...patch, id: 'settings' }, 300);
}

export const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
export const activeSession = () => state.sessions.find((s) => s.status === 'active');

export async function exportBackup() {
  await flush();
  return { app: 'lift-log', version: 1, exportedAt: new Date().toISOString(), data: await db.dumpAll() };
}

export async function importBackup(json) {
  if (json?.app !== 'lift-log' || !json.data) throw new Error('Not a Lift Log backup file');
  await flush();
  await db.restoreAll(json.data);
  await load();
}

// iOS may kill the app when backgrounded: write pending changes right away.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}
