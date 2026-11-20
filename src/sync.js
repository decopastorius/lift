// Push finished sessions to Google Sheets via an Apps Script web app.
// Tracking never depends on this: sessions stay local with syncState 'pending'
// until a push succeeds, and we retry whenever the app is opened or comes online.
import { state, save, remove, emit, byId, exportBackup, saveBackupState, saveSettings } from './store.js';
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
  const deletions = state.sessions.filter((x) => x.status === 'deleted');
  if (!todo.length && !deletions.length && !state.backup.dirty) return;
  state.sync = { ...state.sync, busy: true, lastError: '' };
  emit();
  let ok = true;
  const ctx = {
    exercisesById: byId(state.exercises), locationsById: byId(state.locations), sessions: state.sessions,
    templates: state.templates, layout: state.settings.program || [],
  };
  for (const s of todo) {
    try {
      const r = await postToSheet(sheetUrl, { ...buildPayload(s, ctx), secret: sheetSecret });
      if (r.sheet && r.sheet !== state.settings.sheetName) saveSettings({ sheetName: r.sheet });
      save('sessions', { ...s, syncState: 'synced', syncedAt: Date.now(), syncError: '' });
    } catch (e) {
      save('sessions', { ...s, syncState: 'error', syncError: String(e.message || e) });
      state.sync.lastError = String(e.message || e);
      ok = false;
      break;
    }
  }
  for (const s of ok ? deletions : []) {
    try {
      const p = buildPayload(s, ctx);
      const texts = [...p.program.rows.map((r) => r.log).filter(Boolean), p.program.duration].filter(Boolean);
      await postToSheet(sheetUrl, { app: 'lift-log', action: 'delete', sessionId: s.id, texts, secret: sheetSecret });
      await remove('sessions', s.id);
    } catch (e) {
      state.sync.lastError = String(e.message || e);
      ok = false;
      break;
    }
  }
  if (ok && state.backup.dirty) await backupToDrive();
  state.sync = { ...state.sync, busy: false, lastAt: Date.now() };
  emit();
}

/** Send the full backup (same file as More → Export backup) to Google Drive via the script. */
async function backupToDrive() {
  const { sheetUrl, sheetSecret } = state.settings;
  try {
    // Mark clean before exporting so the uploaded copy records itself as backed up.
    const startedAt = Date.now();
    const r = await postToSheet(sheetUrl, { app: 'lift-log', action: 'backup', secret: sheetSecret, backup: await exportBackup() });
    saveBackupState({ dirty: state.backup.changedAt > startedAt, lastAt: Date.now(), file: r.file || '', error: '' });
  } catch (e) {
    saveBackupState({ error: String(e.message || e) });
  }
}

/** Call whenever data worth backing up changed (finished or edited workout). */
export function markBackupNeeded() {
  saveBackupState({ dirty: true, changedAt: Date.now() });
}

/** Read the coach's Block tabs and equipment settings through the script (for the import). */
export const SCRIPT_VERSION = 4;
export const UPDATE_SCRIPT_HELP = 'The Google script this URL runs is an older version. In Apps Script: paste the new script, Save, then Deploy → Manage deployments → ✏️ Edit → Version: “New version” → Deploy. (A “New deployment” makes a new URL; if you did that, paste the new URL here.)';

export async function readCoachSheet() {
  const { sheetUrl, sheetSecret } = state.settings;
  if (!sheetUrl) throw new Error('Connect the Google Sheet first (More → Google Sheet).');
  let r;
  try {
    r = await postToSheet(sheetUrl, { app: 'lift-log', action: 'readProgram', secret: sheetSecret });
  } catch (e) {
    if (/wrong passphrase|unexpected reply/i.test(e.message)) throw e;
    throw new Error(UPDATE_SCRIPT_HELP);
  }
  if (!r.tabs || (r.version || 0) < SCRIPT_VERSION) throw new Error(UPDATE_SCRIPT_HELP);
  return r;
}

export async function restoreFromDrive() {
  const { sheetUrl, sheetSecret } = state.settings;
  return postToSheet(sheetUrl, { app: 'lift-log', action: 'getBackup', secret: sheetSecret });
}

export async function testConnection(url, secret) {
  return postToSheet(url, { app: 'lift-log', ping: true, secret });
}

/**
 * Delete a finished workout. If it was ever sent to the sheet, it's kept as 'deleted' until the
 * sheet has removed it too (works offline: it goes out with the next sync).
 */
export async function deleteWorkout(session) {
  markBackupNeeded();
  if (session.syncedAt && state.settings.sheetUrl) {
    save('sessions', { ...session, status: 'deleted', syncState: 'pending' });
    syncNow();
  } else {
    await remove('sessions', session.id);
  }
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
