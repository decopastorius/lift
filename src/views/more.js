import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { state, save, remove, saveSettings, exportBackup, importBackup } from '../store.js';
import { NumInput, Field, Toggle, confirmAction } from '../components.js';
import { uid, fmtDate } from '../util.js';
import { testConnection, syncNow, pendingSessions } from '../sync.js';
import { persistStorage, isStandalone } from '../device.js';

export function MoreView() {
  return html`<div class="page">
    <h1>More</h1>
    ${!isStandalone() && html`<div class="banner info"><span>On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b> to install. It then works offline and your data is kept safe.</span></div>`}
    <${Locations} />
    <${Timers} />
    <${SheetSettings} />
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
        <${Field} label="Default rest (s)"><${NumInput} value=${st.defaultRest} onChange=${set('defaultRest')} label="Default rest" /><//>
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
    <h2>Google Sheet (for your coach)</h2>
    <div class="card form">
      <p class="muted small">Optional. Logging works without it. Finished workouts queue up and sync when you’re online.
        Setup steps are in the README (Apps Script → Deploy as web app).</p>
      <${Field} label="Web app URL"><input type="url" value=${st.sheetUrl} placeholder="https://script.google.com/macros/s/…/exec"
        onInput=${(e) => saveSettings({ sheetUrl: e.target.value.trim() })} /><//>
      <${Field} label="Passphrase"><input value=${st.sheetSecret} placeholder="Same as SECRET in the script"
        onInput=${(e) => saveSettings({ sheetSecret: e.target.value })} /><//>
      <div class="actions">
        <span class="muted small">${msg || (pending ? `${pending} workout(s) waiting` : 'All synced')}</span>
        <button class="btn small" disabled=${!st.sheetUrl} onClick=${async () => {
          setMsg('Testing…');
          try { const r = await testConnection(st.sheetUrl, st.sheetSecret); setMsg(`Connected to “${r.sheet}”`); } catch (e) { setMsg('✗ ' + e.message); }
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
  return html`<section>
    <h2>Backup</h2>
    <div class="card form">
      <p class="muted small">Your data lives on this phone. Export a backup now and then (e.g. to iCloud Drive).
        ${persisted === true ? ' Storage is marked persistent ✓' : persisted === false ? ' Storage not yet persistent; install to Home Screen for best safety.' : ''}</p>
      <div class="row2">
        <button class="btn" onClick=${async () => {
          const data = await exportBackup();
          const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          const file = new File([blob], `lift-log-backup-${fmtDate(Date.now())}.json`, { type: 'application/json' });
          if (navigator.canShare?.({ files: [file] })) {
            try { await navigator.share({ files: [file], title: 'Lift Log backup' }); return; } catch { /* fall through */ }
          }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = file.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }}>Export backup</button>
        <label class="btn file-btn">Restore backup
          <input type="file" accept="application/json,.json" onChange=${async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (!confirmAction('Replace ALL data on this device with this backup?')) return;
            try { await importBackup(JSON.parse(await f.text())); setMsg('Backup restored ✓'); } catch (err) { setMsg('✗ ' + err.message); }
          }} />
        </label>
      </div>
      ${msg && html`<p class="small">${msg}</p>`}
    </div>
  </section>`;
}
