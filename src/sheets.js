// Build the rows sent to Google Sheets. Pure — the network call lives in sync.js.
import { SET, SET_NAME, labelSets, isLogged, round } from './progression.js';
import { suggestionFor } from './session-logic.js';
import { formatLog, programRows, weekNumber } from './program.js';
import { fmtDate, fmtTime, fmtLoad } from './util.js';

export const SET_HEADERS = [
  'Session ID', 'Date', 'Start', 'Session', 'Location', 'Exercise', 'Superset', 'Set', 'Set type',
  'Weight (lb)', 'Bodyweight', 'Reps', 'RIR', 'Rest before (s)', 'Logged at',
];

export const SUMMARY_HEADERS = [
  'Session ID', 'Date', 'Week', 'Session', 'Location', 'Duration (min)', 'Exercise', 'Superset',
  'Log', 'Working sets', 'Load (lb)', 'Working reps', 'Volume (lb×reps)',
  'Next time', 'Exercise notes', 'Session notes',
];

/**
 * @param session finished session
 * @param ctx {exercisesById, locationsById, sessions, templates, programStart}
 */
export function buildPayload(session, { exercisesById, locationsById, sessions, templates = [], programStart = '' }) {
  const date = fmtDate(session.startedAt);
  const week = weekNumber(session.startedAt, programStart);
  const logs = {};
  const loc = locationsById[session.locationId]?.name || '';
  const duration = session.endedAt ? Math.round((session.endedAt - session.startedAt) / 6000) / 10 : '';
  const sets = [];
  const summary = [];

  session.exercises.forEach((e, i) => {
    const ex = exercisesById[e.exerciseId] || { name: '(deleted exercise)', bodyweight: false };
    const logged = e.sets.filter(isLogged);
    const labels = labelSets(logged);
    logged.forEach((s, j) => {
      sets.push([
        session.id, date, fmtTime(session.startedAt), session.name, loc, ex.name, e.group || '',
        labels[j], SET_NAME[s.type] || s.type, s.weight ?? '', ex.bodyweight ? 'yes' : '',
        s.reps, s.rir ?? '', s.restBefore ?? '', s.completedAt ? fmtTime(s.completedAt) : '',
      ]);
    });

    const working = logged.filter((s) => s.type === SET.WORKING);
    const loads = [...new Set(working.map((s) => s.weight ?? 0))];
    const log = formatLog(logged, !!ex.bodyweight);
    if (log) logs[e.exerciseId] = logs[e.exerciseId] ? `${logs[e.exerciseId]} | ${log}` : log;
    const volume = logged
      .filter((s) => s.type !== SET.WARMUP)
      .reduce((a, s) => a + (s.weight || 0) * (s.reps || 0), 0);
    let next = '';
    if (exercisesById[e.exerciseId]) {
      const sug = suggestionFor(ex, sessions, { before: session.startedAt });
      const load = fmtLoad(sug.weight, ex.bodyweight);
      if (sug.action === 'increase') next = `↑ ${load} × ${sug.targets[0]}+`;
      else if (sug.action === 'hold') next = `${load} × ${sug.targets.join(', ')}`;
    }
    summary.push([
      session.id, date, week, session.name, loc, i === 0 ? duration : '', ex.name, e.group || '',
      log, working.length, loads.map((w) => (ex.bodyweight ? fmtLoad(w, true) : w)).join(' / '),
      working.map((s) => s.reps).join(', '), round(volume), next, e.notes || '', i === 0 ? session.notes || '' : '',
    ]);
  });

  // The coach's layout: a block per workout, a row per exercise, a column per week.
  const locations = Object.values(locationsById);
  const rows = programRows({ workout: session.name, templates, locations, exercisesById, session })
    .map((r) => ({ ...r, log: logs[r.exerciseId] || '' }));
  const minutes = session.endedAt ? Math.round((session.endedAt - session.startedAt) / 60000) : 0;
  const program = {
    workout: session.name, week, duration: minutes ? `${minutes}'` : '',
    rows: rows.map(({ tag, name, sets, reps, rir, progression, rest, log }) => ({ tag, name, sets, reps, rir, progression, rest, log })),
  };

  return {
    app: 'lift-log',
    sessionId: session.id,
    setHeaders: SET_HEADERS,
    summaryHeaders: SUMMARY_HEADERS,
    sets,
    summary,
    program,
  };
}
