// Push finished sessions to Google Sheets via an Apps Script web app.
// Tracking never depends on this: sessions stay local with syncState 'pending'
// until a push succeeds, and we retry whenever the app is opened or comes online.
import { state, save, emit, byId } from './store.js';
import { buildPayload } from './sheets.js';

export function pendingSessions() {
  return state.sessions.filter((s) => s.status === 'done' && s.syncState !== 'synced');
}

export async function postToSheet(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script does not answer.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Unexpected reply from Google (HTTP ${res.status}). Check the web app URL and that access is "Anyone".`); }
  if (!json.ok) throw new Error(json.error || 'Sheet rejected the data');
  return json;
}

export async function syncNow() {
  const { sheetUrl, sheetSecret } = state.settings;
  if (!sheetUrl || state.sync.busy) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const todo = pendingSessions();
  if (!todo.length) return;
  state.sync = { ...state.sync, busy: true, lastError: '' };
  emit();
  const ctx = { exercisesById: byId(state.exercises), locationsById: byId(state.locations), sessions: state.sessions };
  for (const s of todo) {
    try {
      await postToSheet(sheetUrl, { ...buildPayload(s, ctx), secret: sheetSecret });
      save('sessions', { ...s, syncState: 'synced', syncedAt: Date.now(), syncError: '' });
    } catch (e) {
      save('sessions', { ...s, syncState: 'error', syncError: String(e.message || e) });
      state.sync.lastError = String(e.message || e);
      break;
    }
  }
  state.sync = { ...state.sync, busy: false, lastAt: Date.now() };
  emit();
}

export async function testConnection(url, secret) {
  return postToSheet(url, { app: 'lift-log', ping: true, secret });
}

export function markForResync(session) {
  save('sessions', { ...session, syncState: 'pending' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
}
