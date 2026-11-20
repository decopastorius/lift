import { html, useState } from '../vendor/preact-htm.js';
import { state, save, remove, byId } from '../store.js';
import { labelSets, SET_NAME } from '../progression.js';
import { itemsFromSession } from '../session-logic.js';
import { formatLog, weekOf } from '../program.js';
import { NumInput, Field, NoteField, go, Empty, confirmAction, saveBackupFile } from '../components.js';
import { DEFAULT_NOTE_PRESETS } from '../pickers.js';
import { fmtClock, fmtNiceDate, fmtTime, uid } from '../util.js';
import { syncNow, markBackupNeeded, deleteWorkout } from '../sync.js';
import { begin } from './train.js';

export function HistoryView({ id }) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return html`<${Empty}>Workout not found. <a href="#/">Back</a><//>`;
  const exById = byId(state.exercises);
  const loc = state.locations.find((l) => l.id === s.locationId);
  const template = state.templates.find((t) => t.id === s.templateId);

  // Editing a finished workout marks it for re-sync; the sheet replaces its rows.
  const update = (next) => {
    save('sessions', { ...next, syncState: 'pending' }, 400);
    if (!state.backup.dirty) markBackupNeeded();
    clearTimeout(update.t);
    update.t = setTimeout(syncNow, 3000);
  };
  const patchSet = (exId, setId, patch) => update({
    ...s,
    exercises: s.exercises.map((e) => (e.id !== exId ? e : { ...e, sets: e.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)) })),
  });
  const delSet = (exId, setId) => update({
    ...s, exercises: s.exercises.map((e) => (e.id !== exId ? e : { ...e, sets: e.sets.filter((x) => x.id !== setId) })),
  });

  const repeat = () => {
    if (template) return begin(template);
    begin({ id: null, name: s.name, locationId: s.locationId, items: itemsFromSession(s, state.settings) });
  };


  return html`<div class="page">
    <a class="back" href="#/history">‹ History</a>
    <h1>${s.name}</h1>
    <p class="muted"><label class="wk">Week <${NumInput} value=${weekOf(s, state.sessions)} label="Week" onChange=${(v) => v && update({ ...s, week: v })} /></label> · ${fmtNiceDate(s.startedAt)} ${fmtTime(s.startedAt)} · ${loc?.name || ''} · ${fmtClock(((s.endedAt || s.startedAt) - s.startedAt) / 1000)}</p>
    <${AfterWorkout} s=${s} />
    <div class="row2">
      <button class="btn primary" onClick=${repeat}>Repeat workout</button>
      ${!template && html`<button class="btn" onClick=${() => {
        const name = prompt('Template name', s.name);
        if (!name) return;
        const t = { id: uid(), name, locationId: s.locationId, items: itemsFromSession(s, state.settings), createdAt: Date.now() };
        save('templates', t);
        save('sessions', { ...s, templateId: t.id });
      }}>Save as template</button>`}
    </div>

    ${s.exercises.map((e) => {
      const ex = exById[e.exerciseId] || { name: '(deleted exercise)' };
      const labels = labelSets(e.sets);
      return html`<section class="card">
        <h3><a href=${'#/exercises/' + e.exerciseId}>${ex.name}</a>${e.group ? html` <small class="muted">Superset ${e.group}</small>` : ''}</h3>
        ${e.sets.length > 0 && html`<p class="log-line">${formatLog(e.sets, !!ex.bodyweight)}</p>`}
        ${e.sets.length === 0 && html`<p class="muted">Skipped</p>`}
        <div class="sets">
          ${e.sets.length > 0 && html`<div class="set-row head hist"><span>Set</span><span>lb</span><span>Reps</span><span>RIR</span><span>Rest</span><span></span></div>`}
          ${e.sets.map((x, i) => html`<div class=${'set-row hist t-' + x.type} key=${x.id}>
            <span class="set-label" title=${SET_NAME[x.type]}>${labels[i]}</span>
            <${NumInput} decimal value=${x.weight} label="Weight" onChange=${(v) => patchSet(e.id, x.id, { weight: v })} />
            <${NumInput} value=${x.reps} label="Reps" onChange=${(v) => patchSet(e.id, x.id, { reps: v })} />
            <${NumInput} value=${x.rir} label="RIR" placeholder="–" onChange=${(v) => patchSet(e.id, x.id, { rir: v })} />
            <span class="rest-taken">${x.restBefore != null ? fmtClock(x.restBefore) : ''}</span>
            <button class="x" aria-label="Delete set" onClick=${() => confirmAction('Delete this set?') && delSet(e.id, x.id)}>×</button>
          </div>`)}
        </div>
        ${e.notes && html`<p class="note">${e.notes}</p>`}
      </section>`;
    })}

    <${Field} label="Session notes">
      <${NoteField} value=${s.notes} presets=${(state.settings.notePresets || DEFAULT_NOTE_PRESETS).session} onChange=${(v) => update({ ...s, notes: v })} />
    <//>
    <p class="muted small">Set legend: W = warm-up, numbers = working sets, MA/M = myo activation/mini-sets, P = lengthened partials.</p>
    <button class="btn block danger" onClick=${async () => {
      const inSheet = s.syncedAt && state.settings.sheetUrl;
      if (!confirmAction(`Delete “${s.name}” (week ${weekOf(s, state.sessions)}, ${fmtNiceDate(s.startedAt)})?${inSheet ? ' It will also be removed from the Google Sheet.' : ''} This can’t be undone.`)) return;
      await deleteWorkout(s);
      go('#/history');
    }}>Delete workout</button>
  </div>`;
}

/** Where this workout has been sent: Google Sheet export + Google Drive backup. */
function AfterWorkout({ s }) {
  const b = state.backup;
  const offline = navigator.onLine === false;
  const when = (t) => (t ? ` · ${fmtNiceDate(t)} ${fmtTime(t)}` : '');
  if (!state.settings.sheetUrl) {
    return html`<div class="status-card warn">
      <div>⚠ Google Sheet and Drive backup aren’t set up, so this workout is on this phone only.</div>
      <div class="row2">
        <button class="btn small" onClick=${saveBackupFile}>Save backup file</button>
        <a class="btn small" href="#/more">Set up Google Sheet</a>
      </div>
    </div>`;
  }
  const waiting = offline ? 'offline, will send automatically' : state.sync.busy ? 'sending…' : 'waiting';
  const sheet = s.syncState === 'synced'
    ? html`<span class="ok">✓ Google Sheet${when(s.syncedAt)}</span>`
    : s.syncState === 'error'
      ? html`<span class="bad">✗ Google Sheet: ${s.syncError}</span>`
      : html`<span>⏳ Google Sheet: ${waiting}</span>`;
  const backup = !b.dirty && b.lastAt
    ? html`<span class="ok">✓ Backed up to Google Drive${when(b.lastAt)}</span>`
    : b.error
      ? html`<span class="bad">✗ Drive backup: ${b.error}</span>`
      : html`<span>⏳ Drive backup: ${waiting}</span>`;
  const allDone = s.syncState === 'synced' && !b.dirty;
  return html`<div class=${'status-card' + (allDone ? ' good' : '')}>
    <div>${sheet}</div>
    <div>${backup}</div>
    ${!allDone && !state.sync.busy && html`<button class="btn small" onClick=${syncNow}>Retry now</button>`}
  </div>`;
}

const LOC_KEY = 'liftlog.historyLocation';
const readLoc = () => { try { return localStorage.getItem(LOC_KEY) || ''; } catch { return ''; } };

/** Every finished workout, newest first, grouped by program week. */
export function HistoryList() {
  const [loc, setLoc] = useState(readLoc());
  const pick = (id) => { setLoc(id); try { localStorage.setItem(LOC_KEY, id); } catch { /* ignore */ } };
  const locName = byId(state.locations);
  const all = state.sessions.filter((s) => s.status === 'done');
  const list = all.filter((s) => !loc || s.locationId === loc).sort((a, b) => b.startedAt - a.startedAt);
  const groups = [];
  for (const s of list) {
    const w = weekOf(s, all);
    const g = groups.at(-1);
    if (g && g.week === w) g.items.push(s); else groups.push({ week: w, items: [s] });
  }
  const deleting = state.sessions.filter((s) => s.status === 'deleted').length;
  return html`<div class="page">
    <h1>History</h1>
    <div class="chips">
      <button class=${'chip' + (!loc ? ' on' : '')} onClick=${() => pick('')}>All</button>
      ${state.locations.map((l) => html`<button class=${'chip' + (loc === l.id ? ' on' : '')} onClick=${() => pick(l.id)}>${l.name}</button>`)}
    </div>
    ${deleting > 0 && html`<p class="muted small">${deleting} deleted workout(s) waiting to be removed from the Google Sheet.</p>`}
    ${list.length === 0 && html`<${Empty}>No finished workouts${loc ? ' here' : ''} yet.<//>`}
    ${groups.map((g) => html`<h2>Week ${g.week}</h2><div class="list">
      ${g.items.map((s) => html`<a class="card hist-row" href=${'#/history/' + s.id}>
        <div><strong>${s.name}</strong>
          <small>${fmtNiceDate(s.startedAt)} · ${locName[s.locationId]?.name || ''} · ${fmtClock(((s.endedAt || s.startedAt) - s.startedAt) / 1000)}
            · ${s.exercises.reduce((a, e) => a + e.sets.length, 0)} sets${s.importKey ? ' · imported' : ''}</small></div>
        <span class=${'sync-dot ' + (s.syncState || 'none')} title=${s.syncState === 'synced' ? 'In Google Sheet' : 'Not synced yet'}>
          ${s.syncState === 'synced' ? '✓' : s.syncState === 'error' ? '!' : '•'}</span>
      </a>`)}
    </div>`)}
  </div>`;
}
