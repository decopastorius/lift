import { html, useState } from '../vendor/preact-htm.js';
import { state, save, remove, byId } from '../store.js';
import { newPlanItem } from '../session-logic.js';
import { Field, Stepper, NumInput, ExercisePicker, go, Empty, confirmAction } from '../components.js';
import { uid } from '../util.js';
import { restSeconds } from '../program.js';
import { begin } from './train.js';

export function TemplatesView() {
  const locs = [...state.locations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups = [...locs.map((l) => [l.id, l.name]), ['', 'Any location']];
  return html`<div class="page">
    <div class="title-row"><h1>Templates</h1><a class="btn primary small" href="#/templates/new">＋ New</a></div>
    <p class="muted">Named workouts you can repeat. Progression follows each exercise, whatever the location.</p>
    ${state.templates.length === 0 && html`<${Empty}>No templates yet.<//>`}
    ${groups.map(([id, name]) => {
      const list = state.templates.filter((t) => (t.locationId || '') === id).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) return null;
      return html`<h2>${name}</h2><div class="list">
        ${list.map((t) => html`<div class="card tpl-row">
          <a class="tpl-info" href=${'#/templates/' + t.id}><strong>${t.name}</strong><small>${t.items.length} exercises</small></a>
          <button class="btn primary" onClick=${() => begin(t)}>Start</button>
        </div>`)}
      </div>`;
    })}
  </div>`;
}

export function TemplateEditor({ id }) {
  const existing = state.templates.find((t) => t.id === id);
  const [draft, setDraft] = useState(() => existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), name: '', locationId: state.locations[0]?.id || '', items: [], createdAt: Date.now() });
  const [picker, setPicker] = useState(false);
  const exById = byId(state.exercises);
  if (id !== 'new' && !existing) return html`<${Empty}>Template not found.<//>`;

  const setItem = (i, patch) => setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const move = (i, d) => {
    const items = [...draft.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    setDraft({ ...draft, items });
  };
  const valid = draft.name.trim() && draft.items.length;
  const persist = () => { save('templates', { ...draft, name: draft.name.trim() }); };

  return html`<div class="page">
    <a class="back" href="#/templates">‹ Templates</a>
    <h1>${existing ? 'Edit template' : 'New template'}</h1>
    <${Field} label="Name"><input value=${draft.name} placeholder="e.g. Upper A" onInput=${(e) => setDraft({ ...draft, name: e.target.value })} /><//>
    <${Field} label="Location">
      <select value=${draft.locationId} onChange=${(e) => setDraft({ ...draft, locationId: e.target.value })}>
        ${state.locations.map((l) => html`<option value=${l.id}>${l.name}</option>`)}
        <option value="">Any location</option>
      </select>
    <//>

    <h2>Exercises</h2>
    ${draft.items.length === 0 && html`<${Empty}>Add exercises below.<//>`}
    ${draft.items.map((it, i) => {
      const ex = exById[it.exerciseId];
      return html`<section class="card item" key=${it.id}>
        <div class="ex-head">
          <h3>${i + 1}. ${ex?.name || '(deleted exercise)'}</h3>
          <div class="item-tools">
            <button class="icon-btn" aria-label="Move up" onClick=${() => move(i, -1)}>↑</button>
            <button class="icon-btn" aria-label="Move down" onClick=${() => move(i, 1)}>↓</button>
            <button class="icon-btn" aria-label="Remove" onClick=${() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>✕</button>
          </div>
        </div>
        <div class="plan-grid">
          <span>Warm-up sets</span><${Stepper} label="warm-up sets" value=${it.warmups} onChange=${(v) => setItem(i, { warmups: v })} />
          <span>Working sets</span><${Stepper} label="working sets" value=${it.sets} onChange=${(v) => setItem(i, { sets: v })} />
          <span>Myo-rep sets</span><${Stepper} label="myo-rep sets" value=${it.myo} max=${5} onChange=${(v) => setItem(i, { myo: v })} />
          <span>Lengthened partial sets</span><${Stepper} label="partial sets" value=${it.partials} onChange=${(v) => setItem(i, { partials: v })} />
          <span>Target RIR</span><input class="num" value=${it.rir || ''} placeholder="e.g. 0-1" aria-label="Target RIR" onInput=${(e) => setItem(i, { rir: e.target.value })} />
          <span>Rest (min)</span><input class="num" value=${it.restMin || (it.rest ? String(it.rest / 60) : '')} placeholder="e.g. 3-4" aria-label="Rest minutes"
            onInput=${(e) => setItem(i, { restMin: e.target.value, rest: restSeconds(e.target.value) })} />
          <span>Superset</span>
          <div class="seg">${['', 'A', 'B', 'C', 'D'].map((g) => html`<button class=${(it.group || '') === g ? 'on' : ''} onClick=${() => setItem(i, { group: g })}>${g || '–'}</button>`)}</div>
        </div>
      </section>`;
    })}
    <button class="btn block" onClick=${() => setPicker(true)}>＋ Add exercise</button>

    <div class="actions sticky-actions">
      ${existing && html`<button class="btn danger ghost" onClick=${async () => {
        if (!confirmAction(`Delete template “${existing.name}”? Past workouts are kept.`)) return;
        await remove('templates', existing.id);
        go('#/templates');
      }}>Delete</button>`}
      ${existing && html`<button class="btn" onClick=${() => {
        const copy = { ...JSON.parse(JSON.stringify(draft)), id: uid(), name: draft.name + ' (copy)' };
        copy.items = copy.items.map((x) => ({ ...x, id: uid() }));
        save('templates', copy);
        go('#/templates/' + copy.id);
      }}>Duplicate</button>`}
      <button class="btn primary" disabled=${!valid} onClick=${() => { persist(); go('#/templates'); }}>Save</button>
    </div>
    ${picker && html`<${ExercisePicker} onClose=${() => setPicker(false)} onPick=${(ex) => {
      setDraft({ ...draft, items: [...draft.items, newPlanItem(ex.id, state.settings)] });
      setPicker(false);
    }} />`}
  </div>`;
}
