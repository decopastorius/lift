import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { state, save, remove, byId, activeSession } from '../store.js';
import { SET, labelSets } from '../progression.js';
import { myoNext, blockSets } from '../myo.js';
import {
  logSet, unlogSet, addSet, removeSet, endMyoBlock, finishSession, buildSessionExercise,
  suggestionFor, newPlanItem, itemsFromSession,
} from '../session-logic.js';
import { NumInput, Modal, ExercisePicker, Field, NoteField, go, Empty, confirmAction } from '../components.js';
import { weightOptions, repOptions, RIR_OPTIONS, DEFAULT_NOTE_PRESETS } from '../pickers.js';
import { fmtClock, fmtNiceDate, fmtLoad, uid } from '../util.js';
import { beep, unlockAudio, keepAwake } from '../device.js';
import { syncNow, markBackupNeeded } from '../sync.js';

export function useTick(ms = 500) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function SessionView() {
  const s = activeSession();
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    if (state.settings.keepAwake) keepAwake(true);
    return () => keepAwake(false);
  }, []);
  if (!s) return html`<${Empty}>No workout in progress. <a href="#/">Start one</a><//>`;

  const exById = byId(state.exercises);
  const loc = state.locations.find((l) => l.id === s.locationId);
  const update = (next, delay = 0) => save('sessions', next, delay);

  const addExercise = (exercise) => {
    const item = newPlanItem(exercise.id, state.settings);
    const se = buildSessionExercise(item, exercise, suggestionFor(exercise, state.sessions), state.settings);
    update({ ...s, exercises: [...s.exercises, se] });
    setPicker(false);
    setTimeout(() => document.getElementById('ex-' + se.id)?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // group consecutive exercises sharing a superset letter
  const blocks = [];
  s.exercises.forEach((e, i) => {
    const prev = blocks.at(-1);
    if (e.group && prev && prev.group === e.group) prev.items.push([e, i]);
    else blocks.push({ group: e.group, items: [[e, i]] });
  });

  return html`<div class="session">
    <${SessionHeader} s=${s} loc=${loc} onFinish=${() => setFinishing(true)} update=${update} />
    ${s.exercises.length === 0 && html`<${Empty}>Add your first exercise to get going.<//>`}
    ${blocks.map((b) => {
      const cards = b.items.map(([e, i]) => html`<${ExerciseCard} key=${e.id} s=${s} se=${e} idx=${i}
        exercise=${exById[e.exerciseId]} locationId=${s.locationId} update=${update} />`);
      return b.group && b.items.length > 1
        ? html`<div class="superset"><div class="superset-tag">Superset ${b.group}</div>${cards}</div>`
        : cards;
    })}
    <button class="btn block add-ex" onClick=${() => setPicker(true)}>＋ Add exercise</button>
    <${Field} label="Session notes (for your coach)">
      <${NoteField} value=${s.notes} presets=${(state.settings.notePresets || DEFAULT_NOTE_PRESETS).session}
        onChange=${(v) => update({ ...s, notes: v }, 400)} placeholder="Anything else for your coach" />
    <//>
    <${RestBar} s=${s} update=${update} />
    ${picker && html`<${ExercisePicker} onPick=${addExercise} onClose=${() => setPicker(false)} />`}
    ${finishing && html`<${FinishModal} s=${s} onClose=${() => setFinishing(false)} />`}
  </div>`;
}

function SessionHeader({ s, loc, onFinish, update }) {
  useTick(1000);
  const now = Date.now();
  const done = s.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  return html`<header class="session-head">
    <div class="sh-main">
      <input class="sh-name" value=${s.name} aria-label="Session name" onInput=${(e) => update({ ...s, name: e.target.value }, 400)} />
      <div class="sh-meta">
        <select class="sh-loc" aria-label="Location" value=${s.locationId || ''} onChange=${(e) => update({ ...s, locationId: e.target.value })}>
          ${state.locations.map((l) => html`<option value=${l.id}>${l.name}</option>`)}
        </select>
        ${(s.cycle || 1) > 1 && html`<span>B${s.cycle}</span>`}
        <label class="wk">Wk <${NumInput} value=${s.week} label="Week" onChange=${(v) => v && update({ ...s, week: v, deload: v === (state.settings.cycleWeeks || 8) }, 300)} /></label>
        ${s.deload && html`<span class="badge">Deload</span>`}
        <span>· ${done} set${done === 1 ? '' : 's'}</span>
        ${s.lastSetAt && html`<span>· last set ${fmtClock((now - s.lastSetAt) / 1000)} ago</span>`}
      </div>
    </div>
    <div class="sh-right">
      <div class="sh-clock" aria-label="Session time">${fmtClock((now - s.startedAt) / 1000)}</div>
      <button class="btn small primary" onClick=${onFinish}>Finish</button>
    </div>
  </header>`;
}

function RestBar({ s, update }) {
  useTick(250);
  const beeped = useRef('');
  if (!s.lastSetAt || s.restTarget == null) return null;
  const elapsed = (Date.now() - s.lastSetAt) / 1000;
  const remaining = s.restTarget - elapsed;
  const key = `${s.lastSetAt}:${s.restTarget}`;
  if (remaining <= 0 && beeped.current !== key) {
    beeped.current = key;
    if (state.settings.sound) beep();
  }
  const pct = Math.min(100, (elapsed / Math.max(1, s.restTarget)) * 100);
  const over = remaining <= 0;
  const adj = (d) => update({ ...s, restTarget: Math.max(0, s.restTarget + d) });
  return html`<div class=${'rest-bar' + (over ? ' over' : '')} role="timer">
    <div class="rest-progress" style=${`width:${pct}%`}></div>
    <div class="rest-content">
      <div class="rest-text">
        <small>${over ? 'Go! ' : ''}${s.restLabel || 'Rest'}</small>
        <strong>${over ? '+' + fmtClock(-remaining) : fmtClock(remaining)}</strong>
      </div>
      <button class="btn small ghost" onClick=${() => adj(-15)}>−15</button>
      <button class="btn small ghost" onClick=${() => adj(15)}>+15</button>
      <button class="icon-btn" aria-label="Hide rest timer" onClick=${() => update({ ...s, restTarget: null })}>✕</button>
    </div>
  </div>`;
}

function Target({ sug, exercise, deload }) {
  if (!sug) return null;
  const last = sug.last;
  if (deload) {
    return html`<div class="target deload">
      <strong>Deload: ${last ? fmtLoad(last.load, exercise.bodyweight) : 'usual load'}, stop at RIR ${state.settings.deloadRir || '3-4'}</strong>
      <span>Same exercises and sets, lighter effort. Doesn't count toward progression.</span>
      ${last && html`<small>Last (${fmtNiceDate(last.date)}): ${fmtLoad(last.load, exercise.bodyweight)} × ${last.reps.join(', ')}</small>`}
    </div>`;
  }
  return html`<div class=${'target ' + sug.action}>
    ${sug.action === 'increase' && html`<strong>↑ ${fmtLoad(sug.weight, exercise.bodyweight)} × ${sug.targets[0]}+</strong>`}
    ${sug.action === 'hold' && html`<strong>${fmtLoad(sug.weight, exercise.bodyweight)} → ${sug.targets.join(' · ')}</strong>`}
    <span>${sug.reason}</span>
    ${last && html`<small>Last (${fmtNiceDate(last.date)}): ${fmtLoad(last.load, exercise.bodyweight)} × ${last.reps.join(', ')}</small>`}
  </div>`;
}

function ExerciseCard({ s, se, idx, exercise, locationId, update }) {
  const [menu, setMenu] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [showNotes, setShowNotes] = useState(!!se.notes);
  const [editing, setEditing] = useState(null); // { setId, focus }
  if (!exercise) exercise = { name: '(deleted exercise)', repMin: 8, repMax: 12, setups: {} };
  const labels = labelSets(se.sets);
  const setup = exercise.setups?.[locationId] || exercise.setups?.any;

  const patchSet = (id, patch) => update({
    ...s,
    exercises: s.exercises.map((e) => (e.id !== se.id ? e : { ...e, sets: e.sets.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  }, 300);
  const patchEx = (patch, delay = 0) => update({ ...s, exercises: s.exercises.map((e) => (e.id === se.id ? { ...e, ...patch } : e)) }, delay);

  const toggle = (set) => {
    unlockAudio();
    if (set.done) return update(unlogSet(s, se.id, set.id));
    const next = logSet(s, se.id, set.id, { settings: state.settings, bodyweight: !!exercise.bodyweight });
    if (next === s) return setEditing({ setId: set.id, focus: 'reps' }); // no reps yet: pick them
    update(next);
  };
  const cell = (set, field, text, placeholder) => html`<button class=${'cell' + (text === '' ? ' empty' : '')}
    aria-label=${field} onClick=${() => setEditing({ setId: set.id, focus: field })}>${text === '' ? placeholder : text}</button>`;
  const editSet = editing && se.sets.find((x) => x.id === editing.setId);

  const myoBlocks = [...new Set(se.sets.filter((x) => x.type === SET.MYO_ACT).map((x) => x.block || 0))];
  const lastOfBlock = Object.fromEntries(myoBlocks.map((b) => [blockSets(se.sets, b).at(-1)?.id, b]));

  return html`<section class="card ex-card" id=${'ex-' + se.id}>
    <div class="ex-head">
      <h3><a href=${'#/exercises/' + se.exerciseId}>${exercise.name}</a></h3>
      <button class="icon-btn" aria-label="Exercise options" onClick=${() => setMenu(true)}>⋯</button>
    </div>
    <div class="rx">${[
      `${se.plan?.sets || se.sets.filter((x) => x.type === SET.WORKING).length} × ${exercise.repMin}–${exercise.repMax}`,
      se.rir && `RIR ${se.rir}`,
      se.restMin && `rest ${se.restMin} min`,
      se.rest && `timer ${fmtClock(se.rest)}`,
    ].filter(Boolean).join(' · ')}</div>
    <${Target} sug=${se.suggestion} exercise=${exercise} deload=${s.deload} />
    <button class="setup-line" onClick=${() => setSetupOpen(true)}>
      ⚙ ${setup && (setup.equipment || setup.settings)
        ? html`<span>${[setup.equipment, setup.settings].filter(Boolean).join(' · ')}</span>`
        : html`<span class="muted">Add equipment setup</span>`}
    </button>
    <div class="sets">
      <div class="set-row head"><span>Set</span><span>${exercise.bodyweight ? '+lb' : 'lb'}</span><span>Reps</span><span>RIR</span><span></span><span></span></div>
      ${se.sets.map((set, i) => html`
        <div key=${set.id} class=${`set-row t-${set.type}${set.done ? ' done' : ''}`}>
          <span class="set-label" title=${set.type}>${labels[i]}</span>
          ${cell(set, 'weight', set.weight == null ? '' : exercise.bodyweight && !set.weight ? 'BW' : String(set.weight), exercise.bodyweight ? 'BW' : 'lb')}
          ${cell(set, 'reps', set.reps == null ? '' : String(set.reps), set.target != null ? String(set.target) : `${exercise.repMin}-${exercise.repMax}`)}
          ${set.type === SET.MYO_MINI
            ? html`<span class="muted center">–</span>`
            : cell(set, 'rir', set.rir == null ? '' : String(set.rir), '–')}
          <button class=${'check' + (set.done ? ' on' : '')} aria-label=${set.done ? 'Undo set' : 'Log set'} onClick=${() => toggle(set)}>✓</button>
          ${!set.done
            ? html`<button class="x" aria-label="Remove set" onClick=${() => update(removeSet(s, se.id, set.id))}>×</button>`
            : html`<span class="rest-taken">${set.restBefore != null ? fmtClock(set.restBefore) : ''}</span>`}
        </div>
        ${lastOfBlock[set.id] != null && html`<${MyoGuide} se=${se} block=${lastOfBlock[set.id]}
          onEnd=${() => update(endMyoBlock(s, se.id, lastOfBlock[set.id]))} />`}
      `)}
    </div>
    <div class="add-sets">
      <button class="chip" onClick=${() => update(addSet(s, se.id, SET.WARMUP))}>+ Warm-up</button>
      <button class="chip" onClick=${() => update(addSet(s, se.id, SET.WORKING))}>+ Set</button>
      <button class="chip" onClick=${() => update(addSet(s, se.id, SET.MYO_ACT))}>+ Myo</button>
      <button class="chip" onClick=${() => update(addSet(s, se.id, SET.PARTIAL))}>+ Partial</button>
      ${!showNotes && html`<button class="chip" onClick=${() => setShowNotes(true)}>+ Note</button>`}
    </div>
    ${showNotes && html`<div class="ex-notes"><${NoteField} value=${se.notes} presets=${(state.settings.notePresets || DEFAULT_NOTE_PRESETS).exercise}
      onChange=${(v) => patchEx({ notes: v }, 400)} placeholder="Notes for this exercise" /></div>`}
    ${editSet && html`<${SetSheet} set=${editSet} label=${labels[se.sets.indexOf(editSet)]} se=${se} exercise=${exercise}
      focus=${editing.focus} onPatch=${(p) => patchSet(editSet.id, p)} onClose=${() => setEditing(null)}
      onLog=${() => { if (!editSet.done) toggle(editSet); setEditing(null); }} />`}
    ${menu && html`<${ExerciseMenu} s=${s} se=${se} idx=${idx} exercise=${exercise} update=${update} onClose=${() => setMenu(false)} />`}
    ${setupOpen && html`<${SetupModal} exercise=${exercise} locationId=${locationId} onClose=${() => setSetupOpen(false)} />`}
  </section>`;
}

function PickGroup({ title, value, options, fmt, onPick, decimal, hint, target, onShift }) {
  return html`<div class="pick-group">
    <div class="pick-head"><span>${title}</span>${hint && html`<small>${hint}</small>`}
      <${NumInput} decimal=${decimal} value=${value} label=${title + ' (type)'} placeholder="type" onChange=${onPick} /></div>
    <div class="pick-chips">
      ${onShift && html`<button class="pick shift" aria-label="Lighter" onClick=${() => onShift(-1)}>◀</button>`}
      ${options.map((v) => html`<button class=${'pick' + (v === value ? ' on' : '') + (v === target ? ' tgt' : '')}
        onClick=${() => onPick(v)}>${fmt ? fmt(v) : v}</button>`)}
      ${onShift && html`<button class="pick shift" aria-label="Heavier" onClick=${() => onShift(1)}>▶</button>`}
    </div>
  </div>`;
}

/** Tap-to-pick weight / reps / RIR for one set, with a box to type in as a fallback. */
function SetSheet({ set, label, se, exercise, focus, onPatch, onLog, onClose }) {
  const bw = !!exercise.bodyweight;
  const lastLoad = se.suggestion?.last?.load;
  const [shift, setShift] = useState(0);
  const weights = weightOptions({
    current: set.weight, suggested: se.suggestion?.weight, last: lastLoad, increment: exercise.increment, bodyweight: bw, shift,
  });
  const reps = repOptions({ repMin: exercise.repMin, repMax: exercise.repMax, type: set.type });
  const target = set.target;
  return html`<${Modal} title=${`${exercise.name} · ${label}`} onClose=${onClose}>
    <${PickGroup} name="weight" title=${bw ? 'Added weight (lb)' : 'Weight (lb)'} value=${set.weight} options=${weights} decimal
      fmt=${(v) => (bw ? (v ? '+' + v : 'BW') : v)} onPick=${(v) => { setShift(0); onPick('weight', v); }} onShift=${(d) => setShift(shift + d)} />
    <${PickGroup} name="reps" title="Reps" value=${set.reps} options=${reps} target=${target}
      hint=${target != null ? `target ${target}` : `${exercise.repMin}–${exercise.repMax}`} onPick=${(v) => onPick('reps', v)} />
    ${set.type !== SET.MYO_MINI && html`<${PickGroup} name="rir" title="RIR" value=${set.rir} options=${RIR_OPTIONS}
      hint=${se.rir ? `target ${se.rir}` : ''} onPick=${(v) => onPick('rir', v)} />`}
    <div class="log-bar"><button class="btn primary block" onClick=${onLog}>${set.done ? 'Done' : 'Log set ✓'}</button></div>
  <//>`;
  function onPick(field, v) {
    onPatch(field === 'weight' ? { weight: v, weightEdited: true } : { [field]: v });
  }
}

function MyoGuide({ se, block, onEnd }) {
  const n = myoNext(blockSets(se.sets, block));
  return html`<div class=${'myo-guide ' + n.phase}>
    <span>${n.phase === 'done' ? '✓ ' : '◎ '}${n.message}</span>
    ${n.phase === 'mini' && html`<button class="btn small ghost" onClick=${onEnd}>End set</button>`}
  </div>`;
}

function ExerciseMenu({ s, se, idx, exercise, update, onClose }) {
  const move = (d) => {
    const list = [...s.exercises];
    const j = idx + d;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    update({ ...s, exercises: list });
    onClose();
  };
  const patch = (p) => update({ ...s, exercises: s.exercises.map((e) => (e.id === se.id ? { ...e, ...p } : e)) });
  return html`<${Modal} title=${exercise.name} onClose=${onClose}>
    <div class="row2">
      <button class="btn" onClick=${() => move(-1)} disabled=${idx === 0}>↑ Move up</button>
      <button class="btn" onClick=${() => move(1)} disabled=${idx === s.exercises.length - 1}>↓ Move down</button>
    </div>
    <${Field} label="Superset group" hint="Give consecutive exercises the same letter to alternate them with a short transition rest.">
      <div class="seg">
        ${['', 'A', 'B', 'C', 'D'].map((g) => html`<button class=${se.group === g ? 'on' : ''} onClick=${() => patch({ group: g })}>${g || 'None'}</button>`)}
      </div>
    <//>
    <${Field} label="Rest between sets (seconds)">
      <${NumInput} value=${se.rest} onChange=${(v) => patch({ rest: v })} label="Rest seconds" />
    <//>
    <button class="btn block danger" onClick=${() => {
      if (se.sets.some((x) => x.done) && !confirmAction('Remove this exercise and its logged sets?')) return;
      update({ ...s, exercises: s.exercises.filter((e) => e.id !== se.id) });
      onClose();
    }}>Remove from session</button>
  <//>`;
}

export function SetupModal({ exercise, locationId, onClose }) {
  const loc = state.locations.find((l) => l.id === locationId);
  const key = locationId || 'any';
  const [v, setV] = useState(exercise.setups?.[key] || exercise.setups?.any || { equipment: '', settings: '' });
  const equipment = (loc?.equipment || '').split('\n').map((x) => x.trim()).filter(Boolean);
  return html`<${Modal} title=${'Setup · ' + (loc?.name || 'Any location')} onClose=${onClose}>
    <p class="muted">${exercise.name}: how you set it up${loc ? ' at ' + loc.name : ''}.</p>
    <${Field} label="Equipment">
      <input list="equip" value=${v.equipment} placeholder="e.g. Adjustable bench, 20 lb DBs" onInput=${(e) => setV({ ...v, equipment: e.target.value })} />
      <datalist id="equip">${equipment.map((x) => html`<option value=${x} />`)}</datalist>
    <//>
    <${Field} label="Settings" hint="Seat height, bench angle, pin/hole, cable attachment, grip, stance…">
      <textarea rows="3" value=${v.settings} onInput=${(e) => setV({ ...v, settings: e.target.value })}></textarea>
    <//>
    <div class="actions">
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${() => {
        save('exercises', { ...exercise, setups: { ...(exercise.setups || {}), [key]: v } });
        onClose();
      }}>Save setup</button>
    </div>
  <//>`;
}

const signature = (items) => JSON.stringify(items.map((i) => [i.exerciseId, i.warmups, i.sets, i.myo, i.partials, i.group || '']));

function FinishModal({ s, onClose }) {
  const template = state.templates.find((t) => t.id === s.templateId);
  const items = itemsFromSession(s, state.settings);
  const changed = template && signature(items) !== signature(template.items);
  const [updateTpl, setUpdateTpl] = useState(false);
  const [newTpl, setNewTpl] = useState(!template && s.exercises.length > 0);
  const [tplName, setTplName] = useState(s.name);
  const sets = s.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  const pendingSets = s.exercises.reduce((a, e) => a + e.sets.filter((x) => !x.done).length, 0);

  const finish = () => {
    const done = finishSession(s);
    save('sessions', done);
    if (template && updateTpl) save('templates', { ...template, items });
    if (!template && newTpl && tplName.trim()) {
      const t = { id: uid(), name: tplName.trim(), locationId: s.locationId, items, createdAt: Date.now() };
      save('templates', t);
      save('sessions', { ...done, templateId: t.id, name: t.name });
    }
    markBackupNeeded();
    go('#/history/' + s.id);
    syncNow(); // sheet export, then Drive backup (queued if offline)
  };

  return html`<${Modal} title="Finish workout" onClose=${onClose}>
    <p class="muted small">${state.settings.sheetUrl
      ? 'On finish, the workout is sent to your Google Sheet and a full backup is saved to Google Drive (queued if offline).'
      : 'Google Sheet isn’t set up yet, so this workout stays on this phone only. You can save a backup file on the next screen.'}</p>
    <p><strong>${fmtClock((Date.now() - s.startedAt) / 1000)}</strong> · ${sets} sets logged
      ${pendingSets > 0 && html`<br /><small class="muted">${pendingSets} unlogged set(s) will be dropped.</small>`}</p>
    ${changed && html`<label class="toggle"><input type="checkbox" checked=${updateTpl} onChange=${(e) => setUpdateTpl(e.target.checked)} />
      <span>Update template “${template.name}” to match today’s exercises & sets</span></label>`}
    ${!template && s.exercises.length > 0 && html`
      <label class="toggle"><input type="checkbox" checked=${newTpl} onChange=${(e) => setNewTpl(e.target.checked)} /><span>Save as a template to repeat later</span></label>
      ${newTpl && html`<input value=${tplName} onInput=${(e) => setTplName(e.target.value)} placeholder="Template name" />`}`}
    <div class="actions">
      <button class="btn danger ghost" onClick=${async () => {
        if (!confirmAction('Discard this workout? Nothing will be saved.')) return;
        await remove('sessions', s.id);
        go('#/');
      }}>Discard</button>
      <button class="btn primary" onClick=${finish} disabled=${sets === 0}>Finish & save</button>
    </div>
  <//>`;
}
