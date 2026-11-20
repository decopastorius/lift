// Build the rows sent to Google Sheets. Pure — the network call lives in sync.js.
import { SET, SET_NAME, labelSets, isLogged, round } from './progression.js';
import { suggestionFor } from './session-logic.js';
import { formatLog, weekOf } from './program.js';
import { markPartials, DEFAULT_VOLUME } from './muscles.js';
import { fmtDate, fmtTime, fmtLoad } from './util.js';

export const SET_HEADERS = [
  'Session ID', 'Date', 'Start', 'Session', 'Location', 'Exercise', 'Superset', 'Set', 'Set type',
  'Weight (lb)', 'Bodyweight', 'Reps', 'RIR', 'Rest before (s)', 'Logged at',
  'Rest planned (s)', 'Rest measured', 'Set duration (s)',
];

export const SUMMARY_HEADERS = [
  'Session ID', 'Date', 'Week', 'Session', 'Location', 'Duration (min)', 'Exercise', 'Superset',
  'Log', 'Working sets', 'Load (lb)', 'Working reps', 'Volume (lb×reps)',
  'Next time', 'Exercise notes', 'Session notes',
];

/**
 * @param session finished session
 * @param ctx {exercisesById, locationsById, sessions}
 */
export function buildPayload(raw, { exercisesById, locationsById, sessions, rules = DEFAULT_VOLUME }) {
  const session = markPartials(raw, rules); // partials straight after failure are labelled in the log
  const date = fmtDate(session.startedAt);
  const week = weekOf(session, sessions);
  const logs = {};
  const notes = {};
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
        s.restTarget ?? '', s.restBefore == null ? '' : s.restMeasured ? 'yes' : 'estimated', s.duration ?? '',
      ]);
    });

    const working = logged.filter((s) => s.type === SET.WORKING);
    const loads = [...new Set(working.map((s) => s.weight ?? 0))];
    const log = formatLog(logged, !!ex.bodyweight);
    if (log) logs[e.exerciseId] = logs[e.exerciseId] ? `${logs[e.exerciseId]} | ${log}` : log;
    if (e.notes) notes[e.exerciseId] = notes[e.exerciseId] ? `${notes[e.exerciseId]}; ${e.notes}` : e.notes;
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

  // The log tab for this block: a row per exercise, "Week N" columns (repeated when an exercise
  // is done more than once that week). One entry per exercise done in this workout.
  const log = {
    block: session.cycle || 1, week, deload: !!session.deload, workout: session.name, date, location: loc,
    rows: session.exercises
      .filter((e) => logs[e.exerciseId])
      .filter((e, i, all) => all.findIndex((x) => x.exerciseId === e.exerciseId) === i)
      .map((e) => ({ name: exercisesById[e.exerciseId]?.name || '(deleted exercise)', log: logs[e.exerciseId], note: notes[e.exerciseId] || '' })),
  };

  return {
    app: 'lift-log',
    sessionId: session.id,
    setHeaders: SET_HEADERS,
    summaryHeaders: SUMMARY_HEADERS,
    sets,
    summary,
    log,
  };
}
