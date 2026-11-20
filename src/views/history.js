import { html } from '../vendor/preact-htm.js';
import { state, save, remove, byId } from '../store.js';
import { labelSets, SET_NAME } from '../progression.js';
import { itemsFromSession } from '../session-logic.js';
import { formatLog, weekNumber } from '../program.js';
import { NumInput, Field, go, Empty, confirmAction, saveBackupFile } from '../components.js';
import { fmtClock, fmtNiceDate, fmtTime, uid } from '../util.js';
import { syncNow, markBackupNeeded } from '../sync.js';
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
    <a class="back" href="#/">‹ Train</a>
    <h1>${s.name}</h1>
    <p class="muted">Week ${weekNumber(s.startedAt, state.settings.programStart)} · ${fmtNiceDate(s.startedAt)} ${fmtTime(s.startedAt)} · ${loc?.name || ''} · ${fmtClock(((s.endedAt || s.startedAt) - s.startedAt) / 1000)}</p>
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
      <textarea rows="3" value=${s.notes} onInput=${(ev) => update({ ...s, notes: ev.target.value })}></textarea>
    <//>
    <p class="muted small">Set legend: W = warm-up, numbers = working sets, MA/M = myo activation/mini-sets, P = lengthened partials.</p>
    <button class="btn block danger ghost" onClick=${async () => {
      if (!confirmAction('Delete this workout from the app? (Rows already in Google Sheet stay there.)')) return;
      await remove('sessions', s.id);
      markBackupNeeded();
      go('#/');
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
