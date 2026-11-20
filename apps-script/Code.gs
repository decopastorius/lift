/**
 * Lift Log → Google Sheets receiver. Install it in the coach's spreadsheet.
 *
 * Setup (once):
 *  1. Open the coach's Google Sheet (you need edit access).
 *  2. Extensions → Apps Script. Replace the contents of Code.gs with this file.
 *     (If the sheet already has another script with a doPost function, put this one in a new
 *     Apps Script project instead: script.google.com → New project, then use SHEET_ID below.)
 *  3. Change SECRET below to any passphrase, and save.
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as: Me      Who has access: Anyone
 *     Authorize when asked, then copy the Web app URL (ends in /exec).
 *  5. In Lift Log → More → Google Sheet, paste the URL and the same passphrase, tap "Test".
 *  After editing this file later: Deploy → Manage deployments → Edit → Version: New version.
 *
 * What it writes:
 *  - "Summary" and "Sets" tabs: raw data, one row per exercise / per set.
 *  - The coach's layout: a tab per block ("Block 1", "Block 2", ... = cycle 1, 2, ... in the app).
 *    In it, each workout has a table found by its header row:
 *        [tag] Upper 1 | Sets | Reps | Reps In Reserve | Progression | Rest Time (Min.) | Week 1 ... Week 7
 *    and a deload table (with its own rows) whose header has "Week 8". Each workout goes in the
 *    exercise's row, under its "Week N" column, as "165 x 12, 12 | RIR 1, 0"; the session time
 *    goes in the row under the table. A missing block tab is copied from TEMPLATE_TAB.
 *    Re-sending a workout replaces its cells (the cell note remembers which workout wrote it).
 *  - A full backup of the app's data in the Drive folder below after every workout.
 *
 * It also lets the app read the Block tabs and the equipment-settings tab ("Import from Google Sheet").
 */
const SECRET = 'change-me';
const SCRIPT_VERSION = 4;                   // the app checks this to tell you when the script needs updating
const SHEET_ID = '';                         // only for a standalone script project; leave empty otherwise
const BLOCK_TAB = 'Block ';                  // "Block 1", "Block 2", ...
const TEMPLATE_TAB = 'example new block';    // copied to create the next block's tab
const SETTINGS_TAB = '_Workout_Equipment_Settings';
const BACKUP_FOLDER = 'Lift Log backups';
const KEEP_BACKUPS = 30;

function book() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'Bad JSON' });
  }
  if (data.secret !== SECRET) return reply({ ok: false, error: 'Wrong passphrase' });
  if (data.ping) return reply({ ok: true, sheet: book().getName(), version: SCRIPT_VERSION });
  if (data.action === 'getBackup') return reply(loadBackup());
  if (data.action === 'readProgram') return reply(readProgram(book()));

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (data.action === 'backup') return reply(saveBackup(data.backup));
    const ss = book();
    if (data.action === 'delete') return reply(deleteSession(ss, data.sessionId, data.texts || []));
    upsert(ss, 'Summary', data.summaryHeaders, data.summary, data.sessionId);
    upsert(ss, 'Sets', data.setHeaders, data.sets, data.sessionId);
    if (data.program) writeProgram(ss, data.program, data.sessionId);
    return reply({ ok: true, sheet: ss.getName() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply({ ok: true, app: 'lift-log receiver' });
}

function upsert(ss, name, headers, rows, sessionId) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  removeSessionRows(sh, sessionId);
  if (rows && rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }
}

/** Remove this session's rows (column A = Session ID), bottom-up in blocks. */
function removeSessionRows(sh, sessionId) {
  const last = sh.getLastRow();
  if (last <= 1) return;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  let i = ids.length - 1;
  while (i >= 0) {
    if (ids[i][0] === sessionId) {
      let j = i;
      while (j - 1 >= 0 && ids[j - 1][0] === sessionId) j--;
      sh.deleteRows(j + 2, i - j + 1);
      i = j - 1;
    } else {
      i--;
    }
  }
}

/** A workout deleted in the app: remove its Summary/Sets rows and its cells in the coach's layout. */
function deleteSession(ss, sessionId, texts) {
  for (const name of ['Summary', 'Sets']) {
    const sh = ss.getSheetByName(name);
    if (sh) removeSessionRows(sh, sessionId);
  }
  const tag = 'lift-log:' + sessionId;
  let cleared = 0;
  for (const sh of ss.getSheets()) {
    if (sh.getName() === 'Summary' || sh.getName() === 'Sets') continue;
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (!lastRow || !lastCol) continue;
    const notes = sh.getRange(1, 1, lastRow, lastCol).getNotes();
    for (let r = 0; r < notes.length; r++) {
      for (let c = 0; c < notes[r].length; c++) {
        const note = String(notes[r][c] || '');
        if (note.indexOf(tag) === -1) continue;
        const cell = sh.getRange(r + 1, c + 1);
        // the note is a list of entries "comment lines... + lift-log:<id>"; drop ours
        const entries = [];
        let cur = [];
        for (const line of note.split('\n')) {
          cur.push(line);
          if (line.indexOf('lift-log:') === 0) { entries.push(cur); cur = []; }
        }
        const others = entries.filter((e) => e[e.length - 1] !== tag);
        if (!others.length) {
          cell.clearContent();
          cell.setNote('');
        } else {
          // another workout shares this cell (same week): remove just our line
          const lines = String(cell.getDisplayValue()).split('\n');
          const k = lines.findIndex((l) => texts.indexOf(l) !== -1);
          if (k !== -1 && lines.length > others.length) lines.splice(k, 1);
          cell.setValue(lines.join('\n'));
          cell.setNote(others.map((e) => e.join('\n')).join('\n'));
        }
        cleared++;
      }
    }
  }
  return { ok: true, cleared: cleared };
}

// ---------- coach's layout ----------

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const isSets = (v) => norm(v) === 'sets';

/** Every table for this workout in a tab: header row, name column, week columns, rows by name. */
function findTables(sh, workout) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (!lastRow || !lastCol) return [];
  const vals = sh.getRange(1, 1, lastRow, lastCol + 1).getDisplayValues();
  const out = [];
  for (let r = 0; r < vals.length; r++) {
    for (let c = 0; c < vals[r].length - 1; c++) {
      if (norm(vals[r][c]) !== norm(workout) || !isSets(vals[r][c + 1])) continue;
      const weeks = {};
      let end = c + 1;
      for (let k = c + 2; k < vals[r].length; k++) {
        if (k > c + 2 && isSets(vals[r][k + 1])) break; // the next table on this row
        const m = String(vals[r][k]).match(/^\s*week\s*(\d+)\s*$/i);
        if (m) weeks[Number(m[1])] = k + 1;
        if (String(vals[r][k]).trim()) end = k;
      }
      const rows = {};
      let last = r + 1;
      for (let i = r + 1; i < vals.length; i++) {
        if (isSets(vals[i][c + 1])) break;
        const name = String(vals[i][c]).trim();
        if (!name) continue;
        rows[norm(name)] = i + 1;
        last = i + 1;
      }
      out.push({ sh: sh, header: r + 1, nameCol: c + 1, first: Math.max(1, c), lastCol: end + 1, weeks: weeks, rows: rows, last: last });
    }
  }
  return out;
}

/** The block's tab: existing, else a copy of the template, else a new empty tab. */
function blockSheet(ss, cycle) {
  const name = BLOCK_TAB + (cycle || 1);
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  const tpl = ss.getSheetByName(TEMPLATE_TAB);
  if (tpl) {
    sh = tpl.copyTo(ss);
    sh.setName(name);
    clearWeeks(sh);
    return sh;
  }
  return ss.insertSheet(name);
}

/** A new block starts empty: clear the week cells of every table (example rows are kept). */
function clearWeeks(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (!lastRow || !lastCol) return;
  const vals = sh.getRange(1, 1, lastRow, lastCol + 1).getDisplayValues();
  for (let r = 0; r < vals.length; r++) {
    for (let c = 0; c < vals[r].length - 1; c++) {
      if (!String(vals[r][c]).trim() || !isSets(vals[r][c + 1]) || isSets(vals[r][c])) continue;
      const t = findTables(sh, vals[r][c]).filter((x) => x.header === r + 1 && x.nameCol === c + 1)[0];
      if (!t) continue;
      for (const w of Object.keys(t.weeks)) {
        for (let i = t.header + 1; i <= t.last + 1; i++) {
          if (/^example/i.test(String((vals[i - 1] || [])[c] || '').trim())) continue;
          const cell = sh.getRange(i, t.weeks[w]);
          if (String(cell.getDisplayValue()).trim()) { cell.clearContent(); cell.setNote(''); }
        }
      }
    }
  }
}

function createTable(sh, p) {
  const start = sh.getLastRow() ? sh.getLastRow() + 2 : 1;
  const values = [['', p.workout, 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)']]
    .concat(p.rows.map((r) => [r.tag, r.name, r.sets, r.reps, r.rir, r.progression, r.rest]));
  const range = sh.getRange(start, 1, values.length, 7);
  range.setNumberFormat('@'); // keep "8-10" from turning into a date
  range.setValues(values);
  sh.getRange(start, 1, 1, 7).setFontWeight('bold');
  return findTables(sh, p.workout)[0];
}

/** Column for week N in a table: its "Week N" header, else a new header after the last one. */
function weekColumn(t, week) {
  if (t.weeks[week]) return t.weeks[week];
  const cols = Object.keys(t.weeks).map((w) => t.weeks[w]);
  let col = cols.length ? Math.max.apply(null, cols) + 1 : Math.max(t.lastCol + 1, t.nameCol + 6);
  while (String(t.sh.getRange(t.header, col).getDisplayValue()).trim()) col++;
  t.sh.getRange(t.header, col).setValue('Week ' + week).setFontWeight('bold');
  t.weeks[week] = col;
  if (col > t.lastCol) t.lastCol = col;
  return col;
}

/**
 * Write a log cell. Your notes for the coach go in the cell's note (hover to read), followed by
 * a "lift-log:<id>" line that remembers which workout wrote it, so a re-send replaces it.
 */
function writeCell(range, text, sessionId, comment) {
  const tag = 'lift-log:' + sessionId;
  const note = range.getNote();
  const current = range.getDisplayValue();
  const mine = note.indexOf(tag) !== -1;
  const owners = (note.match(/lift-log:/g) || []).length;
  const newNote = (comment ? comment + '\n' : '') + tag;
  range.setNumberFormat('@');
  if (!current || (mine && owners === 1) || (current === text && owners === 0)) {
    range.setValue(text);
    range.setNote(newNote);
  } else if (current === text && !mine) {
    // same value from another workout (e.g. the same session time): share the cell
    range.setNote(note + '\n' + newNote);
  } else if (!mine) {
    // a second workout in the same week: keep both
    range.setValue(current + '\n' + text);
    range.setNote(note ? note + '\n' + newNote : newNote);
  }
}

function writeProgram(ss, p, sessionId) {
  if (!p || !p.workout) return;
  const sh = blockSheet(ss, p.cycle);
  const tables = findTables(sh, p.workout);
  // the table that has this week's column (week 8 lives in the deload table), else the main one
  let t = tables.filter((x) => x.weeks[p.week])[0]
    || tables.sort((a, b) => Object.keys(b.weeks).length - Object.keys(a.weeks).length)[0]
    || createTable(sh, p);
  // exercises the table doesn't list yet (e.g. created mid-workout): insert a row inside the
  // table's own columns only, so tables beside it don't move
  for (const r of p.rows) {
    if (!r.log || t.rows[norm(r.name)]) continue;
    const width = t.lastCol - t.first + 1;
    sh.getRange(t.last + 1, t.first, 1, width).insertCells(SpreadsheetApp.Dimension.ROWS);
    const cells = sh.getRange(t.last + 1, t.nameCol - 1, 1, 2);
    cells.setNumberFormat('@');
    cells.setValues([[r.tag || '', r.name]]);
    const header = sh.getRange(t.header, t.nameCol, 1, width).getDisplayValues()[0].map(norm);
    const put = (label, v) => { const k = header.indexOf(label); if (k > 0) sh.getRange(t.last + 1, t.nameCol + k).setNumberFormat('@').setValue(v); };
    put('sets', String(r.sets || ''));
    put('reps', r.reps || '');
    put('reps in reserve', r.rir || '');
    put('progression', r.progression || '');
    put('rest time (min.)', r.rest || '');
    t = findTables(sh, p.workout).filter((x) => x.header === t.header && x.nameCol === t.nameCol)[0];
  }
  const col = weekColumn(t, p.week);
  for (const r of p.rows) {
    if (r.log && t.rows[norm(r.name)]) writeCell(sh.getRange(t.rows[norm(r.name)], col), r.log, sessionId, r.note);
  }
  // session time goes in the row right under the table, if that row is free
  if (p.duration && !String(sh.getRange(t.last + 1, t.nameCol).getDisplayValue()).trim()) {
    writeCell(sh.getRange(t.last + 1, col), p.duration, sessionId, p.note);
  }
}

/** For "Import from Google Sheet" in the app: the Block tabs and the equipment settings, as displayed. */
function readProgram(ss) {
  const grid = (sh) => {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (!lastRow || !lastCol) return [];
    const vals = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    while (vals.length && !vals[vals.length - 1].some((v) => String(v).trim())) vals.pop();
    return vals;
  };
  const tabs = {};
  for (const sh of ss.getSheets()) {
    if (/^\s*block\s*\d+\s*$/i.test(sh.getName())) tabs[sh.getName()] = grid(sh);
  }
  const st = ss.getSheets().filter((sh) => norm(sh.getName()) === norm(SETTINGS_TAB))[0];
  return { ok: true, sheet: ss.getName(), version: SCRIPT_VERSION, tabs: tabs, settings: st ? grid(st) : [] };
}

// ---------- Drive backups ----------

function backupFolder() {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}

function backupFiles(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^lift-log-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName()) && !f.isTrashed()) files.push(f);
  }
  return files.sort((a, b) => b.getName().localeCompare(a.getName())); // newest first
}

function saveBackup(backup) {
  if (!backup || backup.app !== 'lift-log') return { ok: false, error: 'Not a Lift Log backup' };
  const folder = backupFolder();
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const name = 'lift-log-backup-' + day + '.json';
  const json = JSON.stringify(backup);
  const same = folder.getFilesByName(name);
  let file = null;
  while (same.hasNext() && !file) {
    const f = same.next();
    if (!f.isTrashed()) file = f;
  }
  if (file) file.setContent(json);
  else folder.createFile(name, json, 'application/json');
  backupFiles(folder).slice(KEEP_BACKUPS).forEach((f) => f.setTrashed(true));
  return { ok: true, file: name };
}

function loadBackup() {
  const newest = backupFiles(backupFolder())[0];
  if (!newest) return { ok: true, backup: null };
  return { ok: true, file: newest.getName(), backup: JSON.parse(newest.getBlob().getDataAsString()) };
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
