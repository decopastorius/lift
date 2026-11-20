import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { state, save, exportBackup } from './store.js';
import { newExercise } from './seed.js';
import { num, byName, fmtDate } from './util.js';
import { hasNote, toggleNote } from './pickers.js';
import { isCompound } from './session-logic.js';
const fmtRest = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`;

export const go = (path) => { location.hash = path; };

/** Numeric input that keeps the typed text (so "2." and "" work) and reports a number|null. */
export function NumInput({ value, onChange, placeholder = '', decimal = false, cls = '', label, disabled }) {
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ?? ''); }, [value]);
  return html`<input
    class=${'num ' + cls} type="text" inputmode=${decimal ? 'decimal' : 'numeric'}
    aria-label=${label} placeholder=${placeholder} value=${text} disabled=${disabled}
    onFocus=${(e) => { focused.current = true; e.target.select(); }}
    onBlur=${() => { focused.current = false; setText(value ?? ''); }}
    onInput=${(e) => { setText(e.target.value); onChange(num(e.target.value)); }} />`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);
  return html`<div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-label=${title}>
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></div>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

export function Field({ label, children, hint }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<small class="hint">${hint}</small>`}</label>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle"><input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /><span>${label}</span></label>`;
}

export function Stepper({ value, onChange, min = 0, max = 20, label }) {
  return html`<div class="stepper" aria-label=${label}>
    <button type="button" onClick=${() => onChange(Math.max(min, (value || 0) - 1))} aria-label=${'Fewer ' + label}>−</button>
    <span>${value || 0}</span>
    <button type="button" onClick=${() => onChange(Math.min(max, (value || 0) + 1))} aria-label=${'More ' + label}>+</button>
  </div>`;
}

export function ExerciseForm({ value, onChange }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const cats = [...new Set(state.exercises.map((e) => e.category).filter(Boolean))].sort();
  return html`<div class="form">
    <${Field} label="Name"><input value=${value.name} onInput=${(e) => set('name')(e.target.value)} placeholder="e.g. Seated DB Press" /><//>
    <${Field} label="Category">
      <input list="cats" value=${value.category} onInput=${(e) => set('category')(e.target.value)} placeholder="Chest, Back, Legs…" />
      <datalist id="cats">${cats.map((c) => html`<option value=${c} />`)}</datalist>
    <//>
    <div class="row3">
      <${Field} label="Reps min"><${NumInput} value=${value.repMin} onChange=${set('repMin')} label="Minimum reps" /><//>
      <${Field} label="Reps max"><${NumInput} value=${value.repMax} onChange=${set('repMax')} label="Maximum reps" /><//>
      <${Field} label="+ lb"><${NumInput} decimal value=${value.increment} onChange=${set('increment')} label="Weight increment" /><//>
    </div>
    <${Toggle} checked=${value.bodyweight} onChange=${set('bodyweight')} label="Bodyweight exercise (weight = added load)" />
    <${Toggle} checked=${isCompound(value)} onChange=${set('compound')} label=${`Compound movement (rest timer ${fmtRest(state.settings.compoundRest)}; otherwise ${fmtRest(state.settings.isolationRest)})`} />
  </div>`;
}

/** Search the library; create a new exercise on the fly if it isn't there. */
export function ExercisePicker({ onPick, onClose, title = 'Add exercise' }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(null);
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  const ql = q.trim().toLowerCase();
  const list = state.exercises
    .filter((e) => !ql || e.name.toLowerCase().includes(ql) || (e.category || '').toLowerCase().includes(ql))
    .sort(byName);

  if (creating) {
    return html`<${Modal} title="New exercise" onClose=${onClose}>
      <${ExerciseForm} value=${creating} onChange=${setCreating} />
      <div class="actions">
        <button class="btn" onClick=${() => setCreating(null)}>Back</button>
        <button class="btn primary" disabled=${!creating.name.trim()} onClick=${() => {
          const ex = { ...creating, name: creating.name.trim() };
          save('exercises', ex);
          onPick(ex);
        }}>Create & add</button>
      </div>
    <//>`;
  }

  return html`<${Modal} title=${title} onClose=${onClose}>
    <input ref=${ref} class="search" type="search" placeholder="Search or type a new name" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${q.trim() && !list.some((e) => e.name.toLowerCase() === ql) && html`
      <button class="btn block create" onClick=${() => setCreating(newExercise({ name: q.trim() }))}>＋ Create “${q.trim()}”</button>`}
    <ul class="pick-list">
      ${list.map((e) => html`<li><button onClick=${() => onPick(e)}>
        <span>${e.name}</span><small>${e.category || ''} · ${e.repMin}–${e.repMax}${e.bodyweight ? ' · BW' : ''}</small>
      </button></li>`)}
    </ul>
    ${!q && html`<button class="btn block" onClick=${() => setCreating(newExercise())}>＋ New exercise</button>`}
  <//>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

export function confirmAction(msg) {
  return window.confirm(msg);
}

/** Save the full backup as a JSON file (iPhone: opens the Share sheet → Save to Files). */
export async function saveBackupFile() {
  const data = await exportBackup();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], `lift-log-backup-${fmtDate(Date.now())}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Lift Log backup' }); return; } catch { /* fall back to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Preset notes you tap to add/remove, plus free text. */
export function NoteField({ value, onChange, presets = [], placeholder = '', rows = 2 }) {
  return html`<div class="note-field">
    <div class="note-chips">${presets.map((p) => html`<button type="button" class=${'chip' + (hasNote(value, p) ? ' on' : '')}
      onClick=${() => onChange(toggleNote(value, p))}>${p}</button>`)}</div>
    <textarea rows=${rows} placeholder=${placeholder} value=${value || ''} onInput=${(e) => onChange(e.target.value)}></textarea>
  </div>`;
}
