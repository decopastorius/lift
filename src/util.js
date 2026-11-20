export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the week containing ts, as YYYY-MM-DD. */
export function mondayOf(ts) {
  const d = new Date(ts);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtDate(d.getTime());
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtNiceDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** seconds -> m:ss or h:mm:ss */
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "45 lb", "BW", "BW+25 lb" */
export function fmtLoad(w, bodyweight) {
  if (bodyweight) return w ? `BW+${w} lb` : 'BW';
  return w == null ? '–' : `${w} lb`;
}

export function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function byName(a, b) {
  return a.name.localeCompare(b.name);
}
