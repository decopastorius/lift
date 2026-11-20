import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { state, save, remove, saveSettings, importBackup, byId } from '../store.js';
import { NumInput, Field, Toggle, Modal, confirmAction, saveBackupFile } from '../components.js';
import { uid, fmtDate, fmtNiceDate } from '../util.js';
import { planImport } from '../importer.js';
import { formatLog } from '../program.js';
import { DEFAULT_NOTE_PRESETS } from '../pickers.js';
import { testConnection, syncNow, pendingSessions, markBackupNeeded, restoreFromDrive } from '../sync.js';
import { persistStorage, isStandalone } from '../device.js';

export function MoreView() {
  return html`<div class="page">
    <h1>More</h1>
    ${!isStandalone() && html`<div class="banner info"><span>On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b> to install. It then works offline and your data is kept safe.</span></div>`}
    <${Locations} />
    <${Timers} />
    <${NotePresets} />
    <${SheetSettings} />
    <${CoachSheet} />
    <${Backup} />
    <p class="muted small center">Lift Log · data is stored on this device only, plus your Google Sheet.</p>
  </div>`;
}

function Locations() {
  const [open, setOpen] = useState(null);
  const locs = [...state.locations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return html`<section>
    <div class="title-row"><h2>Locations</h2>
      <button class="btn small" onClick=${() => {
        const l = { id: uid(), name: 'New location', order: locs.length, equipment: '' };
        save('locations', l);
        setOpen(l.id);
      }}>＋ Add</button></div>
    <div class="list compact">
      ${locs.map((l) => html`<div class="card loc">
        <button class="loc-head" onClick=${() => setOpen(open === l.id ? null : l.id)}>
          <strong>${l.name}</strong><small>${(l.equipment || '').split('\n').filter((x) => x.trim()).length} equipment items</small>
        </button>
        ${open === l.id && html`<div class="form">
          <${Field} label="Name"><input value=${l.name} onInput=${(e) => save('locations', { ...l, name: e.target.value }, 400)} /><//>
          <${Field} label="Equipment available" hint="One per line, e.g. “Dumbbells 5–50 lb (5 lb steps)”. Shown when you set up exercises here.">
            <textarea rows="5" value=${l.equipment} onInput=${(e) => save('locations', { ...l, equipment: e.target.value }, 400)}></textarea>
          <//>
          <button class="btn small danger ghost" onClick=${() => {
            if (state.templates.some((t) => t.locationId === l.id) && !confirmAction('Templates use this location; they will become "Any location". Delete?')) return;
            for (const t of state.templates.filter((t) => t.locationId === l.id)) save('templates', { ...t, locationId: '' });
            remove('locations', l.id);
          }}>Delete location</button>
        </div>`}
      </div>`)}
    </div>
  </section>`;
}

function Timers() {
  const st = state.settings;
  const set = (k) => (v) => saveSettings({ [k]: v ?? 0 });
  return html`<section>
    <h2>Rest timer</h2>
    <div class="card form">
      <div class="row2">
        <${Field} label="Compound (s)"><${NumInput} value=${st.compoundRest} onChange=${set('compoundRest')} label="Compound rest" /><//>
        <${Field} label="Isolation (s)"><${NumInput} value=${st.isolationRest} onChange=${set('isolationRest')} label="Isolation rest" /><//>
        <${Field} label="After warm-up (s)"><${NumInput} value=${st.warmupRest} onChange=${set('warmupRest')} label="Warm-up rest" /><//>
        <${Field} label="Myo mini-set (s)"><${NumInput} value=${st.myoRest} onChange=${set('myoRest')} label="Myo rest" /><//>
        <${Field} label="Superset switch (s)"><${NumInput} value=${st.supersetRest} onChange=${set('supersetRest')} label="Superset transition" /><//>
      </div>
      <${Toggle} checked=${st.sound} onChange=${set('sound')} label="Beep when rest is over (iPhone: ring/silent switch must be on ring)" />
      <${Toggle} checked=${st.keepAwake} onChange=${set('keepAwake')} label="Keep screen on during a workout" />
    </div>
  </section>`;
}

function SheetSettings() {
  const st = state.settings;
  const [msg, setMsg] = useState('');
  const pending = pendingSessions().length;
  return html`<section>
    <h2>Google Sheet & Drive backup</h2>
    <div class="card form">
      <p class="muted small">Optional. Logging works without it. Finished workouts queue up and sync when you’re online.
        Setup steps are in the README (Apps Script → Deploy as web app).</p>
      ${st.sheetUrl && st.sheetName && html`<p class="connected">Logging to Google Sheet <strong>“${st.sheetName}”</strong></p>`}
      <div class="script-links">
        <a class="btn small" href="https://github.com/decopastorius/lift/blob/main/apps-script/Code.gs" target="_blank" rel="noopener">Open the script</a>
        <button class="btn small" onClick=${async () => {
          try {
            const code = await (await fetch('apps-script/Code.gs', { cache: 'no-store' })).text();
            await navigator.clipboard.writeText(code);
            setMsg('Script copied. Paste it into Extensions → Apps Script in your sheet.');
          } catch (e) { setMsg('✗ Couldn’t copy (are you online?). Use “Open the script”.'); }
        }}>Copy the script</button>
      </div>
      <${Field} label="Web app URL" hint="The URL belongs to the sheet you installed the script in (Extensions → Apps Script in that sheet). To log to another sheet, install the script there and paste its URL.">
        <input type="url" value=${st.sheetUrl} placeholder="https://script.google.com/macros/s/…/exec"
          onInput=${(e) => saveSettings({ sheetUrl: e.target.value.trim(), sheetName: '' })} /><//>
      <${Field} label="Passphrase"><input value=${st.sheetSecret} placeholder="Same as SECRET in the script"
        onInput=${(e) => saveSettings({ sheetSecret: e.target.value })} /><//>
      <div class="actions">
        <span class="muted small">${msg || (pending ? `${pending} workout(s) waiting` : 'All synced')}</span>
        <button class="btn small" disabled=${!st.sheetUrl} onClick=${async () => {
          setMsg('Testing…');
          try { const r = await testConnection(st.sheetUrl, st.sheetSecret); saveSettings({ sheetName: r.sheet }); setMsg(`Connected to “${r.sheet}”`); } catch (e) { setMsg('✗ ' + e.message); }
        }}>Test</button>
        <button class="btn small primary" disabled=${!st.sheetUrl || !pending || state.sync.busy} onClick=${syncNow}>Sync now</button>
      </div>
      ${state.sync.lastError && html`<p class="error small">${state.sync.lastError}</p>`}
      <button class="btn small ghost" onClick=${() => {
        if (!confirmAction('Re-send every workout to the sheet? Existing rows for them are replaced, not duplicated.')) return;
        for (const s of state.sessions.filter((x) => x.status === 'done')) save('sessions', { ...s, syncState: 'pending' });
        syncNow();
      }}>Re-send all workouts</button>
    </div>
  </section>`;
}

function Backup() {
  const [persisted, setPersisted] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { persistStorage().then(setPersisted); }, []);
  const b = state.backup;
  const connected = !!state.settings.sheetUrl;
  return html`<section>
    <h2>Backup</h2>
    <div class="card form">
      <p class="small"><strong>Automatic:</strong> after every workout, a full backup is saved to the
        “Lift Log backups” folder in your Google Drive (one per day, last 30 days kept).</p>
      <p class="small ${b.error ? 'error' : 'muted'}">${!connected ? 'Needs the Google Sheet connection above.'
        : b.error ? 'Last attempt failed: ' + b.error
        : b.lastAt ? `Last backup: ${new Date(b.lastAt).toLocaleString()}${b.file ? ' (' + b.file + ')' : ''}${b.dirty ? '. New changes waiting' : ''}`
        : 'No backup yet.'}</p>
      <div class="row2">
        <button class="btn" disabled=${!connected || state.sync.busy} onClick=${() => { markBackupNeeded(); syncNow(); }}>Back up now</button>
        <button class="btn" disabled=${!connected} onClick=${async () => {
          if (!confirmAction('Replace ALL data on this phone with the latest Google Drive backup?')) return;
          setMsg('Downloading…');
          try {
            const r = await restoreFromDrive();
            if (!r.backup) throw new Error('No backup found in Google Drive yet');
            await importBackup(r.backup);
            setMsg(`Restored ${r.file} ✓`);
          } catch (err) { setMsg('✗ ' + err.message); }
        }}>Restore from Drive</button>
      </div>
      <p class="muted small">Backup file on this phone (e.g. to Files / iCloud Drive):
        ${persisted === true ? ' storage is marked persistent ✓' : persisted === false ? ' install to Home Screen for safest storage.' : ''}</p>
      <div class="row2">
        <button class="btn" onClick=${saveBackupFile}>Save backup file</button>
        <label class="btn file-btn">Restore from file
          <input type="file" accept="application/json,.json" onChange=${async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (!confirmAction('Replace ALL data on this phone with this backup?')) return;
            try { await importBackup(JSON.parse(await f.text())); setMsg('Backup restored ✓'); } catch (err) { setMsg('✗ ' + err.message); }
          }} />
        </label>
      </div>
      ${msg && html`<p class="small">${msg}</p>`}
    </div>
  </section>`;
}

function CoachSheet() {
  const [importing, setImporting] = useState(false);
  const layout = state.settings.program || [];
  return html`<section>
    <h2>Coach's program sheet</h2>
    <div class="card form">
      <p class="muted small">Each workout is written into the coach's layout: its block (${layout.map((b) => b.name).join(', ') || 'e.g. Upper 1'}),
        the exercise's row and the “Week N” column, as <code>165 x 12, 12 | RIR 1, 0</code>, with the session time under the block.
        A week is one round of the program; each workout gets the week after the last one logged (you can change it on the workout).</p>
      <div class="row2">
        <${Field} label="Weeks per cycle" hint="The last week is the deload."><${NumInput} value=${state.settings.cycleWeeks || 8} label="Weeks per cycle" onChange=${(v) => v && saveSettings({ cycleWeeks: v })} /><//>
        <${Field} label="Deload RIR"><input value=${state.settings.deloadRir || '3-4'} onInput=${(e) => saveSettings({ deloadRir: e.target.value })} /><//>
      </div>
      <button class="btn block" onClick=${() => setImporting(true)}>Import from the coach's sheet</button>
      <p class="muted small">Paste either the whole program (header rows + week columns) to update exercises, rep ranges, templates
        and history, or just one week's column (values only) to add that week as history.</p>
    </div>
    ${importing && html`<${ImportSheet} onClose=${() => setImporting(false)} />`}
  </section>`;
}

function ImportSheet({ onClose }) {
  const [text, setText] = useState('');
  const [lastDate, setLastDate] = useState(fmtDate(Date.now() - 86400000));
  const [week, setWeek] = useState(null);
  const [done, setDone] = useState('');
  const layout = state.settings.program || [];
  const plan = text.trim() ? planImport(text, state, { layout, lastDate, week, cycleWeeks: state.settings.cycleWeeks || 8 }) : null;
  const locName = byId(state.locations);
  const exName = byId(state.exercises);
  const nameOf = (id) => exName[id]?.name || plan?.exercises.find((e) => e.id === id)?.name || '?';
  const apply = () => {
    if (plan.layout) saveSettings({ program: plan.layout });
    for (const e of plan.exercises) save('exercises', e);
    for (const t of plan.templates) save('templates', t);
    for (const s of plan.sessions) save('sessions', s);
    if (plan.sessions.length) markBackupNeeded();
    setDone(`Imported ${plan.templates.length ? plan.templates.length + ' templates and ' : ''}${plan.sessions.length} past workouts.`);
    setText('');
  };
  return html`<${Modal} title="Import from the coach's sheet" onClose=${onClose}>
    <p class="muted small">Copy from Google Sheets and paste below: the whole program, or one week's column
      (from the first exercise down; include the “Week N” lines).</p>
    <textarea rows="8" value=${text} placeholder="Paste here" onInput=${(e) => { setText(e.target.value); setDone(''); }}></textarea>
    <div class="row2">
      <${Field} label="Last workout in the paste was on"><input type="date" value=${lastDate} onInput=${(e) => setLastDate(e.target.value)} /><//>
      ${plan?.missingWeek && html`<${Field} label="Which week is this?"><${NumInput} value=${week} label="Week" onChange=${setWeek} /><//>`}
    </div>
    ${done && html`<p class="small">✓ ${done}</p>`}
    ${plan && html`<div class="import-preview">
      ${plan.mode === 'program' && html`<p><strong>Whole program:</strong> ${plan.workouts.map((w) => `${w.name} (${w.rows.length})`).join(', ')}.
        ${plan.templates.length} templates${plan.exercises.length ? `, ${plan.exercises.length} exercises added/updated` : ''}.</p>`}
      ${plan.mode === 'column' && html`<p><strong>One week's values</strong>, lined up with the program:</p>`}
      ${plan.sessions.map((s) => html`<div class="preview-session">
        <strong>${s.name}</strong> · week ${s.week} · ${locName[s.locationId]?.name || ''} · ${fmtNiceDate(s.startedAt)}
        <ul>${s.exercises.map((e) => html`<li>${nameOf(e.exerciseId)}: <code>${formatLog(e.sets, !!(exName[e.exerciseId]?.bodyweight))}</code></li>`)}</ul>
      </div>`)}
      ${plan.sessions.length === 0 && html`<p class="muted">No new workouts to add${plan.missingWeek && !week ? ' (enter the week number)' : ''}.</p>`}
      ${plan.warnings.map((w) => html`<p class="error small">${w}</p>`)}
    </div>`}
    <div class="actions">
      <button class="btn" onClick=${onClose}>Close</button>
      <button class="btn primary" disabled=${!plan || (!plan.sessions.length && !plan.templates.length)} onClick=${apply}>Import</button>
    </div>
  <//>`;
}

function NotePresets() {
  const p = state.settings.notePresets || DEFAULT_NOTE_PRESETS;
  const set = (k) => (e) => saveSettings({ notePresets: { ...p, [k]: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) } });
  return html`<section>
    <h2>Quick notes</h2>
    <div class="card form">
      <p class="muted small">Tap-to-add notes for your coach, one per line.</p>
      <${Field} label="Exercise notes"><textarea rows="5" value=${p.exercise.join('\n')} onChange=${set('exercise')}></textarea><//>
      <${Field} label="Session notes"><textarea rows="4" value=${p.session.join('\n')} onChange=${set('session')}></textarea><//>
    </div>
  </section>`;
}
