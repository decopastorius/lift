import { html, useState, useRef, useEffect } from '../vendor/preact-htm.js';
import { state, byId } from '../store.js';
import { MUSCLES, DEFAULT_VOLUME, weeklyVolume, weekLabel, musclesFor } from '../muscles.js';
import { analyse, STATUS, codeName } from '../fatigue.js';
import { Empty, go } from '../components.js';

const MAX_WEEKS = 12;
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function ProgressView() {
  const rules = { ...DEFAULT_VOLUME, ...(state.settings.volume || {}) };
  const exById = byId(state.exercises);
  const volume = weeklyVolume(state.sessions, exById, rules);
  const result = analyse(state.sessions, exById, volume, { cycleWeeks: state.settings.cycleWeeks || 8 });
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(null);
  if (!volume.length) return html`<div class="page"><h1>Progress</h1><${Empty}>Finish a workout (or import your history in More) to see volume and progress.<//></div>`;

  const shown = volume.slice(-MAX_WEEKS);
  const rateByKey = Object.fromEntries(result.weeks.map((w) => [w.key, w]));
  const current = shown.find((w) => w.key === sel) || shown.filter((w) => !w.deload).at(-1) || shown.at(-1);
  const flagged = result.exercises.filter((x) => ['regressing', 'stalled', 'grinding'].includes(x.status.key));

  return html`<div class="page progress">
    <h1>Progress</h1>

    ${result.alerts.length === 0 && html`<div class="status-card good"><span class="ok">▲ No whole-body fatigue signal</span>
      <small>Most exercises are still progressing, and no muscle is going backwards while its volume rises.${flagged.length
        ? ` Flagged individually: ${flagged.map((x) => `${x.exercise.name} (${STATUS[x.status.key].label.toLowerCase()})`).join(', ')}. See Exercises below.` : ''}</small></div>`}
    ${result.alerts.map((a) => html`<div class=${'alert tone-' + a.tone}>
      <strong><span class="alert-icon" aria-hidden="true">${a.tone === 'serious' ? '▼' : '◆'}</span> ${a.title}</strong>
      <span>${a.text}</span>
    </div>`)}

    <h2>Fatigue over time</h2>
    <p class="muted small">Volume (top) and the share of exercises that progressed (bottom), week by week. When volume holds or rises
      while the bottom line falls, fatigue is building. Tap a week.</p>
    <${WeekCharts} weeks=${shown} rates=${rateByKey} selected=${current.key} onSelect=${(k) => { setSel(k); setOpen(null); }} rules=${rules} />

    <h2>Sets per muscle · ${weekLabel(current)}${current.deload ? ' (deload)' : ''}</h2>
    <${MuscleBars} week=${current} rules=${rules} open=${open} onOpen=${(m) => setOpen(open === m ? null : m)} />

    <h2>Muscle × week</h2>
    <${Heatmap} weeks=${shown} selected=${current.key} onSelect=${setSel} rules=${rules} />

    <h2>Exercises</h2>
    <${ExerciseList} items=${result.exercises} />

    <p class="muted small">Counting: primary muscle 1 set, secondary ${fmt(rules.secondary)}; a myo-rep activation set 1 and each
      mini-set ${fmt(Math.round(rules.myoMini * 100) / 100)}; lengthened partials ${fmt(rules.partial)} as a set of their own,
      ${fmt(Math.round(rules.partialAfter * 100) / 100)} straight after failure${rules.partialSecondary ? '' : ', main muscle only'}; sets logged above RIR ${rules.maxRir}
      and warm-ups don't count. Change these in More → Volume counting, and an exercise's muscles on its page.</p>
  </div>`;
}

/** Two aligned single-series charts sharing the week columns (never one chart with two scales). */
function WeekCharts({ weeks, rates, selected, onSelect }) {
  const W = 340; const L = 30; const R = 6; const colW = (W - L - R) / weeks.length;
  const x = (i) => L + i * colW;
  const maxSets = Math.max(10, ...weeks.map((w) => w.total));
  const top = Math.ceil(maxSets / 10) * 10;
  const H1 = 120; const H2 = 90; const pad = 8;
  const y1 = (v) => pad + (H1 - pad - 4) * (1 - v / top);
  const y2 = (v) => pad + (H2 - pad - 4) * (1 - v);
  const barW = Math.max(6, Math.min(18, colW - 6));
  const sel = weeks.find((w) => w.key === selected);
  const rate = sel && rates[sel.key];
  const pts = weeks.map((w, i) => ({ w, i, r: rates[w.key] })).filter((p) => !p.w.deload && p.r?.rate != null);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${(x(p.i) + colW / 2).toFixed(1)},${y2(p.r.rate).toFixed(1)}`).join(' ');
  const hit = (H) => weeks.map((w, i) => html`<rect class="hit" x=${x(i)} y="0" width=${colW} height=${H} onClick=${() => onSelect(w.key)}>
    <title>${weekLabel(w)}</title></rect>`);
  return html`<div class="viz">
    <div class="viz-title">Hard sets per week</div>
    <svg viewBox=${`0 0 ${W} ${H1 + 4}`} role="img" aria-label="Hard sets per week">
      <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" class="hatch-bg" /><line x1="0" y1="0" x2="0" y2="5" class="hatch-line" /></pattern></defs>
      ${[0, top / 2, top].map((v) => html`<line class="grid" x1=${L} x2=${W - R} y1=${y1(v)} y2=${y1(v)} /><text class="axis" x=${L - 4} y=${y1(v) + 3} text-anchor="end">${v}</text>`)}
      ${weeks.map((w, i) => (i > 0 && w.block !== weeks[i - 1].block ? html`<line class="block-sep" x1=${x(i)} x2=${x(i)} y1="2" y2=${y1(0)} />` : null))}
      ${weeks.map((w, i) => {
        const h = Math.max(0, y1(0) - y1(w.total));
        const bx = x(i) + (colW - barW) / 2;
        return html`<path class=${'bar' + (w.deload ? ' deload' : '') + (w.key === selected ? ' sel' : '')}
          d=${`M${bx},${y1(0)} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`} />`;
      })}
      ${hit(H1)}
    </svg>
    <div class="viz-title">Exercises progressing</div>
    <svg viewBox=${`0 0 ${W} ${H2 + 18}`} role="img" aria-label="Share of exercises that progressed each week">
      ${[0, 0.5, 1].map((v) => html`<line class="grid" x1=${L} x2=${W - R} y1=${y2(v)} y2=${y2(v)} /><text class="axis" x=${L - 4} y=${y2(v) + 3} text-anchor="end">${v * 100}%</text>`)}
      ${path && html`<path class="line" d=${path} />`}
      ${pts.map((p) => html`<circle class=${'dot' + (p.w.key === selected ? ' sel' : '')} cx=${x(p.i) + colW / 2} cy=${y2(p.r.rate)} r=${p.w.key === selected ? 5 : 4} />`)}
      ${weeks.map((w, i) => html`<text class=${'axis' + (w.key === selected ? ' strong' : '')} x=${x(i) + colW / 2} y=${H2 + 14} text-anchor="middle">${w.deload ? 'D' : w.week}</text>`)}
      ${weeks.map((w, i) => (i > 0 && w.block !== weeks[i - 1].block ? html`<line class="block-sep" x1=${x(i)} x2=${x(i)} y1="2" y2=${H2 + 16} />` : null))}
      ${weeks.map((w, i) => (i === 0 || w.block !== weeks[i - 1].block ? html`<text class="axis block-lbl" x=${x(i) + 2} y="7">Block ${w.block}</text>` : null))}
      ${hit(H2 + 18)}
    </svg>
    <div class="viz-foot">
      <span class="muted small">Weeks of ${[...new Set(weeks.map((w) => 'block ' + w.block))].join(' & ')} · D = deload (hatched, not counted for progress)</span>
    </div>
    ${sel && html`<div class="readout"><strong>${weekLabel(sel)}${sel.deload ? ' · deload' : ''}</strong>
      <span>${fmt(sel.total)} hard sets</span>
      <span>${rate ? `${Math.round(rate.rate * 100)}% of ${rate.n} exercises progressed${rate.r ? `, ${rate.r} regressed` : ''}` : 'no progress data'}</span></div>`}
  </div>`;
}

function MuscleBars({ week, rules, open, onOpen }) {
  const max = Math.max(rules.high + 4, ...Object.values(week.muscles));
  const pct = (v) => `${(v / max) * 100}%`;
  const rows = MUSCLES.filter((m) => week.muscles[m] != null || state.exercises.some((e) => musclesFor(e).primary.includes(m)));
  return html`<div class="muscle-bars">
    <div class="mb-scale"><span style=${`left:${pct(rules.low)}`}>${rules.low}</span><span style=${`left:${pct(rules.high)}`}>${rules.high}</span></div>
    ${rows.map((m) => {
      const v = week.muscles[m] || 0;
      const from = week.from[m] || {};
      return html`<div class="mb-row">
        <button class="mb-head" onClick=${() => onOpen(m)} aria-expanded=${open === m}>
          <span class="mb-name">${m}</span>
          <span class="mb-track">
            <span class="mb-band" style=${`left:${pct(rules.low)};width:${pct(rules.high - rules.low)}`}></span>
            <span class="mb-bar" style=${`width:${pct(v)}`}></span>
          </span>
          <span class="mb-val">${fmt(v)}</span>
        </button>
        ${open === m && html`<ul class="mb-from">
          ${Object.entries(from).sort((a, b) => b[1] - a[1]).map(([n, s]) => html`<li><span>${n}</span><span>${fmt(s)}</span></li>`)}
          ${!Object.keys(from).length && html`<li class="muted">No hard sets this week.</li>`}
        </ul>`}
      </div>`;
    })}
    <p class="muted small">Shaded: a typical hypertrophy range of ${rules.low}–${rules.high} hard sets a week (research average; your coach's plan may aim
      lower or higher on purpose). Tap a muscle to see where its sets come from.</p>
  </div>`;
}

function Heatmap({ weeks, selected, onSelect, rules }) {
  const rows = MUSCLES.filter((m) => weeks.some((w) => w.muscles[m]));
  const step = (v) => (v <= 0 ? 0 : Math.min(6, 1 + Math.floor((v / rules.high) * 6)));
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth; }, [weeks.length]);
  return html`<div class="heat-wrap" ref=${ref}><table class="heat">
    <thead><tr><th class="sticky">B·W</th>${weeks.map((w) => html`<th class=${w.key === selected ? 'sel' : ''} onClick=${() => onSelect(w.key)}>${w.block}·${w.deload ? 'D' : w.week}</th>`)}</tr></thead>
    <tbody>${rows.map((m) => html`<tr><th class="sticky">${m}</th>${weeks.map((w) => {
      const v = w.muscles[m] || 0;
      return html`<td class=${`h${step(v)}${w.key === selected ? ' sel' : ''}`} title=${`${m}, ${weekLabel(w)}: ${fmt(v)} sets`}>${v ? fmt(v) : ''}</td>`;
    })}</tr>`)}</tbody>
  </table></div>`;
}

const CODE = {
  P: { icon: '▲', tone: 'good' }, F: { icon: '●', tone: 'muted' }, G: { icon: '◆', tone: 'warning' }, R: { icon: '▼', tone: 'critical' },
};

function ExerciseList({ items }) {
  return html`<div class="list compact">
    ${items.map((x) => {
      const st = STATUS[x.status.key];
      const recent = x.list.slice(-8).filter((e) => e.code !== 'S');
      const last = x.list.at(-1);
      return html`<button class="card ex-status" onClick=${() => go('#/exercises/' + x.exercise.id)}>
        <div class="es-top">
          <strong>${x.exercise.name}</strong>
          <span class=${'chip-status tone-' + st.tone}><span aria-hidden="true">${st.icon}</span> ${st.label}</span>
        </div>
        <div class="es-bottom">
          <span class="codes" aria-label=${recent.map((e) => codeName[e.code]).join(', ')}>
            ${recent.map((e) => html`<span class=${'code tone-' + CODE[e.code].tone} title=${`${weekLabel(e)}: ${codeName[e.code]} (${e.load} × ${e.reps.join(', ')})`}>${CODE[e.code].icon}</span>`)}
          </span>
          <small>${last.load || 'BW'} × ${last.reps.join(', ')}${x.status.since ? ` · ${x.status.since} without progress` : ''}</small>
        </div>
      </button>`;
    })}
    <p class="muted small legend">▲ progress · ● flat · ◆ grind (same output, harder) · ▼ regress — oldest to newest, deloads skipped.
      Stalled = 3 in a row without progress; regressing = 2 of the last 3 backwards.</p>
  </div>`;
}
