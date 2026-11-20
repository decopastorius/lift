import { html, useState } from '../vendor/preact-htm.js';
import { state, save, byId, activeSession } from '../store.js';
import { startSession } from '../session-logic.js';
import { nextWeek } from '../program.js';
import { go, Empty, confirmAction } from '../components.js';
import { fmtClock, fmtNiceDate } from '../util.js';
import { pendingSessions, syncNow } from '../sync.js';
import { unlockAudio } from '../device.js';

const LOC_KEY = 'liftlog.location';
const getLoc = () => { try { return localStorage.getItem(LOC_KEY) || ''; } catch { return ''; } };
const setLocStore = (v) => { try { localStorage.setItem(LOC_KEY, v); } catch { /* ignore */ } };

export function begin(template, locationId) {
  unlockAudio();
  const act = activeSession();
  if (act) {
    if (confirmAction(`“${act.name}” is still in progress. Resume it?`)) go('#/session');
    return;
  }
  const s = startSession({
    template, locationId, exercisesById: byId(state.exercises), sessions: state.sessions, settings: state.settings,
  });
  save('sessions', s);
  go('#/session');
}

export function TrainView() {
  const [loc, setLoc] = useState(getLoc());
  const act = activeSession();
  const locations = [...state.locations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const locName = byId(state.locations);
  const templates = state.templates
    .filter((t) => !loc || t.locationId === loc)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lastDone = (tid) => state.sessions.filter((s) => s.templateId === tid && s.status === 'done')
    .reduce((m, s) => Math.max(m, s.startedAt), 0);
  const history = state.sessions.filter((s) => s.status === 'done')
    .filter((s) => !loc || s.locationId === loc)
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
  const pending = pendingSessions();
  const pick = (id) => { setLoc(id); setLocStore(id); };

  return html`<div class="page">
    <h1>Train</h1>
    ${act && html`<button class="card resume" onClick=${() => go('#/session')}>
      <div><strong>${act.name}</strong><small>In progress · ${locName[act.locationId]?.name || ''} · ${fmtClock((Date.now() - act.startedAt) / 1000)}</small></div>
      <span class="btn primary small">Resume</span>
    </button>`}

    <div class="chips" role="tablist">
      <button class=${'chip' + (!loc ? ' on' : '')} onClick=${() => pick('')}>All</button>
      ${locations.map((l) => html`<button class=${'chip' + (loc === l.id ? ' on' : '')} onClick=${() => pick(l.id)}>${l.name}</button>`)}
    </div>

    <h2>Templates</h2>
    ${templates.length === 0 && html`<${Empty}>No templates${loc ? ' for ' + locName[loc]?.name : ''} yet.
      <a href="#/templates/new">Create one</a> or start an empty workout and save it at the end.<//>`}
    <div class="list">
      ${templates.map((t) => {
        const last = lastDone(t.id);
        return html`<div class="card tpl-row">
          <a class="tpl-info" href=${'#/templates/' + t.id}>
            <strong>${t.name}</strong>
            <small>${locName[t.locationId]?.name || 'Any'} · ${t.items.length} exercises · week ${nextWeek(t.name, state.sessions)} next${last ? ' · last ' + fmtNiceDate(last) : ''}</small>
          </a>
          <button class="btn primary" onClick=${() => begin(t)}>Start</button>
        </div>`;
      })}
    </div>
    <button class="btn block" onClick=${() => begin(null, loc || locations[0]?.id)}>Start empty workout${loc ? ' · ' + locName[loc]?.name : ''}</button>

    ${state.settings.sheetUrl
      ? pending.length > 0 && html`<div class="banner">
          <span>${pending.length} workout${pending.length > 1 ? 's' : ''} not in Google Sheet yet${state.sync.lastError ? ': ' + state.sync.lastError : ''}</span>
          <button class="btn small" disabled=${state.sync.busy} onClick=${syncNow}>${state.sync.busy ? 'Syncing…' : 'Sync now'}</button>
        </div>`
      : history.length > 0 && html`<div class="banner"><span>Google Sheet sync isn’t set up.</span><a class="btn small" href="#/more">Set up</a></div>`}

    <h2>History</h2>
    ${history.length === 0 && html`<${Empty}>Finished workouts show up here.<//>`}
    <div class="list">
      ${history.map((s) => html`<a class="card hist-row" href=${'#/history/' + s.id}>
        <div><strong>${s.name}</strong>
          <small>${fmtNiceDate(s.startedAt)} · ${locName[s.locationId]?.name || ''} · ${fmtClock(((s.endedAt || s.startedAt) - s.startedAt) / 1000)}</small></div>
        <span class=${'sync-dot ' + (s.syncState || 'none')} title=${s.syncState === 'synced' ? 'In Google Sheet' : 'Not synced yet'}>
          ${s.syncState === 'synced' ? '✓' : s.syncState === 'error' ? '!' : '•'}</span>
      </a>`)}
    </div>
  </div>`;
}
