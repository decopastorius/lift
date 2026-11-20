import { html, useState } from '../vendor/preact-htm.js';
import { state, save, remove, byId } from '../store.js';
import { historyFor, suggestionFor } from '../session-logic.js';
import { isLogged, labelSets, e1rm, SET } from '../progression.js';
import { ExerciseForm, Modal, Field, go, Empty, confirmAction } from '../components.js';
import { newExercise, parseExerciseList } from '../seed.js';
import { fmtNiceDate, fmtLoad, byName } from '../util.js';
import { SetupModal } from './session.js';
import { MUSCLES, musclesFor, DEFAULT_VOLUME } from '../muscles.js';

export function ExercisesView() {
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const ql = q.trim().toLowerCase();
  const list = state.exercises
    .filter((e) => !ql || e.name.toLowerCase().includes(ql) || (e.category || '').toLowerCase().includes(ql))
    .sort(byName);
  const cats = [...new Set(list.map((e) => e.category || 'Other'))].sort();
  return html`<div class="page">
    <div class="title-row"><h1>Exercises</h1>
      <div><button class="btn small" onClick=${() => setImporting(true)}>Import list</button>
      <a class="btn primary small" href="#/exercises/new">＋ New</a></div></div>
    <input class="search" type="search" placeholder="Search exercises" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${list.length === 0 && html`<${Empty}>No matches. <a href="#/exercises/new">Create “${q}”</a><//>`}
    ${cats.map((c) => html`<h2>${c}</h2><div class="list compact">
      ${list.filter((e) => (e.category || 'Other') === c).map((e) => html`<a class="card ex-row" href=${'#/exercises/' + e.id}>
        <span>${e.name}</span><small>${e.repMin}–${e.repMax} reps · +${e.increment} lb${e.bodyweight ? ' · BW' : ''}</small>
      </a>`)}
    </div>`)}
    ${importing && html`<${ImportModal} onClose=${() => setImporting(false)} />`}
  </div>`;
}

function ImportModal({ onClose }) {
  const [text, setText] = useState('');
  const parsed = parseExerciseList(text);
  const existing = new Set(state.exercises.map((e) => e.name.toLowerCase()));
  const fresh = parsed.filter((p) => !existing.has(p.name.toLowerCase()));
  return html`<${Modal} title="Import exercises" onClose=${onClose}>
    <p class="muted small">One per line: <code>Name, Category, 8-12, 5, bw</code>. Only the name is required; the rest is rep range, lb increment and “bw” for bodyweight. Existing names are skipped.</p>
    <textarea rows="10" value=${text} placeholder=${'Seated DB Press, Shoulders, 8-12, 5\nRing Row, Back, 8-15, 5, bw'} onInput=${(e) => setText(e.target.value)}></textarea>
    <div class="actions">
      <span class="muted">${fresh.length} new${parsed.length - fresh.length ? `, ${parsed.length - fresh.length} already exist` : ''}</span>
      <button class="btn primary" disabled=${!fresh.length} onClick=${() => {
        for (const f of fresh) save('exercises', newExercise(f));
        onClose();
      }}>Import ${fresh.length || ''}</button>
    </div>
  <//>`;
}

function Chart({ points }) {
  if (points.length < 2) return null;
  const W = 320; const H = 90; const P = 6;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys); const max = Math.max(...ys);
  const x = (i) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v) => H - P - ((v - min) / Math.max(1, max - min)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  return html`<figure class="chart">
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Estimated 1RM over time">
      <path d=${d} fill="none" stroke="currentColor" stroke-width="2" />
      ${points.map((p, i) => html`<circle cx=${x(i)} cy=${y(p.y)} r="3"><title>${fmtNiceDate(p.date)}: ${p.y}</title></circle>`)}
    </svg>
    <figcaption>Best estimated 1RM per session: ${min} → ${ys.at(-1)} lb</figcaption>
  </figure>`;
}

export function ExerciseDetail({ id }) {
  const existing = state.exercises.find((e) => e.id === id);
  const [draft, setDraft] = useState(() => (existing ? { ...existing } : newExercise()));
  const [setupFor, setSetupFor] = useState(null);
  if (id !== 'new' && !existing) return html`<${Empty}>Exercise not found.<//>`;
  const FIELDS = ['name', 'category', 'repMin', 'repMax', 'increment', 'bodyweight', 'compound', 'notes'];
  const dirty = !existing || FIELDS.some((k) => draft[k] !== existing[k]);
  const locName = byId(state.locations);
  const history = existing ? historyFor(existing.id, state.sessions).reverse() : [];
  const sug = existing ? suggestionFor(existing, state.sessions) : null;
  const points = [...history].reverse().map((h) => ({
    date: h.date,
    y: Math.max(...h.sets.filter((s) => isLogged(s) && s.type !== SET.WARMUP).map((s) => e1rm(s.weight || 0, s.reps)), 0),
  })).filter((p) => p.y > 0);
  const usedIn = existing ? state.templates.filter((t) => t.items.some((i) => i.exerciseId === id)) : [];

  return html`<div class="page">
    <a class="back" href="#/exercises">‹ Exercises</a>
    <h1>${existing ? existing.name : 'New exercise'}</h1>
    <${ExerciseForm} value=${draft} onChange=${setDraft} />
    <${Field} label="Notes / cues"><textarea rows="2" value=${draft.notes} onInput=${(e) => setDraft({ ...draft, notes: e.target.value })}></textarea><//>
    <div class="actions">
      ${existing && html`<button class="btn danger ghost" onClick=${async () => {
        const n = history.length;
        if (!confirmAction(`Delete “${existing.name}”?${n ? ` It appears in ${n} past workouts (they keep their data).` : ''}${usedIn.length ? ` It will be removed from ${usedIn.length} template(s).` : ''}`)) return;
        for (const t of usedIn) save('templates', { ...t, items: t.items.filter((i) => i.exerciseId !== id) });
        await remove('exercises', id);
        go('#/exercises');
      }}>Delete</button>`}
      <button class="btn primary" disabled=${!draft.name.trim() || !dirty} onClick=${() => {
        // merge onto the latest record so setups edited meanwhile are kept
        const fields = Object.fromEntries(FIELDS.map((k) => [k, draft[k]]));
        save('exercises', { ...(existing || draft), ...fields, name: draft.name.trim() });
        if (!existing) go('#/exercises/' + draft.id);
      }}>${existing ? 'Save changes' : 'Create'}</button>
    </div>

    ${existing && html`
      <h2>Muscles worked</h2>
      <${MusclePicker} exercise=${existing} />
      <h2>Equipment setup</h2>
      <div class="list compact">
        ${[...state.locations, { id: 'any', name: 'Any location' }].map((l) => {
          const st = existing.setups?.[l.id];
          return html`<button class="card setup-row" onClick=${() => setSetupFor(l.id)}>
            <strong>${l.name}</strong>
            <small>${st && (st.equipment || st.settings) ? [st.equipment, st.settings].filter(Boolean).join(' · ') : 'Not set'}</small>
          </button>`;
        })}
      </div>

      <h2>Progression</h2>
      ${sug && html`<div class=${'target ' + sug.action}>
        ${sug.action !== 'start' && html`<strong>Next: ${fmtLoad(sug.weight, existing.bodyweight)} × ${sug.action === 'increase' ? sug.targets[0] + '+' : sug.targets.join(' · ')}</strong>`}
        <span>${sug.reason}</span></div>`}
      <${Chart} points=${points} />
      ${history.length === 0 && html`<p class="muted">No logged sets yet.</p>`}
      <div class="list compact">
        ${history.map((h) => {
          const sets = h.sets.filter(isLogged);
          const labels = labelSets(sets);
          return html`<a class="card hist-ex" href=${'#/history/' + h.sessionId}>
            <div><strong>${fmtNiceDate(h.date)}</strong> <small>${locName[h.locationId]?.name || ''}</small></div>
            <small>${sets.map((s, i) => `${labels[i]}: ${existing.bodyweight && !s.weight ? 'BW' : s.weight}×${s.reps}`).join('  ')}</small>
          </a>`;
        })}
      </div>
    `}
    ${setupFor && html`<${SetupModal} exercise=${existing} locationId=${setupFor === 'any' ? null : setupFor} onClose=${() => setSetupFor(null)} />`}
  </div>`;
}

/** Tap a muscle to cycle: not worked → primary (1 set) → secondary (½ set). Saved on the exercise. */
function MusclePicker({ exercise }) {
  const m = musclesFor(exercise);
  const own = !!(exercise.muscles?.primary?.length || exercise.muscles?.secondary?.length);
  const half = (state.settings.volume || DEFAULT_VOLUME).secondary ?? 0.5;
  const cycle = (name) => {
    const primary = m.primary.filter((x) => x !== name);
    const secondary = m.secondary.filter((x) => x !== name);
    if (m.primary.includes(name)) secondary.push(name);
    else if (!m.secondary.includes(name)) primary.push(name);
    save('exercises', { ...exercise, muscles: { primary, secondary } });
  };
  return html`<div class="muscle-picker">
    <div class="note-chips">${MUSCLES.map((name) => {
      const kind = m.primary.includes(name) ? 'primary' : m.secondary.includes(name) ? 'secondary' : '';
      return html`<button class=${'chip ' + (kind === 'primary' ? 'on' : kind === 'secondary' ? 'half' : '')} onClick=${() => cycle(name)}>
        ${name}${kind === 'primary' ? ' · 1' : kind === 'secondary' ? ` · ${half === 0.5 ? '½' : half}` : ''}</button>`;
    })}</div>
    <p class="muted small">Tap to cycle: primary (counts 1 set) → secondary (${half === 0.5 ? '½' : half} set) → off.
      ${own ? html`<button class="linklike" onClick=${() => save('exercises', { ...exercise, muscles: null })}>Reset to automatic</button>` : 'Currently guessed from the name.'}</p>
  </div>`;
}
