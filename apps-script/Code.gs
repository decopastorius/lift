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
 *  - A log tab per block: "Block 2 log", "Block 3 log", ... One row per exercise (column A),
 *    "Week N" columns along the top. An exercise done twice in a week fills a second "Week N"
 *    column (added when needed), so location and session don't matter. Each cell holds the coach's
 *    format, "165 x 12, 12 | RIR 1, 0"; its note says when/where, plus your notes for the coach.
 *    Re-sending or deleting a workout updates or clears its own cells.
 *  - A full backup of the app's data in the Drive folder below after every workout.
 *  The coach's own tabs ("Block 1", "Block 2", ...) are only read, never changed.
 *
 * It also lets the app read the Block tabs and the equipment-settings tab ("Import from Google Sheet").
 */
const SECRET = 'change-me';
const SCRIPT_VERSION = 6;                   // the app checks this to tell you when the script needs updating
const SHEET_ID = '';                         // only for a standalone script project; leave empty otherwise
const LOG_TAB = (block) => 'Block ' + block + ' log';   // where workouts are written
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
    if (data.log) writeLog(ss, data.log, data.sessionId);
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
  } else {
    // new columns added in a later version: extend the header row
    const current = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (current.join('|') !== headers.join('|')) sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
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

// ---------- log tab: a row per exercise, "Week N" columns ----------

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const weekOf = (header) => Number((String(header).match(/^\s*week\s*(\d+)/i) || [])[1]) || null;

function logSheet(ss, block) {
  const name = LOG_TAB(block || 1);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1).setValue('Exercise').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(1);
  }
  return sh;
}

/** The exercise's row (column A), added at the bottom the first time. */
function exerciseRow(sh, name) {
  const last = sh.getLastRow();
  if (last > 1) {
    const names = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (let i = 0; i < names.length; i++) if (norm(names[i][0]) === norm(name)) return i + 2;
  }
  const row = Math.max(last, 1) + 1;
  sh.getRange(row, 1).setNumberFormat('@').setValue(name);
  return row;
}

/**
 * The column for this workout's entry in this week: the cell it wrote before (re-send), else the
 * first free "Week N" column in the row, else a new "Week N" column right after the others.
 */
function weekSlot(sh, row, week, label, tag) {
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
  const cols = [];
  let after = 1; // insert new columns after the last column of an earlier or same week
  for (let c = 2; c <= width; c++) {
    const w = weekOf(header[c - 1]);
    if (w === week) cols.push(c);
    if (w != null && w <= week) after = c;
  }
  if (cols.length) {
    const notes = sh.getRange(row, cols[0], 1, cols[cols.length - 1] - cols[0] + 1).getNotes()[0];
    const vals = sh.getRange(row, cols[0], 1, cols[cols.length - 1] - cols[0] + 1).getDisplayValues()[0];
    for (const c of cols) if (String(notes[c - cols[0]] || '').indexOf(tag) !== -1) return c;
    for (const c of cols) if (!String(vals[c - cols[0]] || '').trim()) return c;
  }
  sh.insertColumnAfter(after);
  sh.getRange(1, after + 1).setValue(label).setFontWeight('bold');
  return after + 1;
}

/**
 * Write a log cell. The note says when/where and carries your notes for the coach, then a
 * "lift-log:<id>" line that remembers which workout wrote it, so a re-send replaces it.
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
    range.setNote(note + '\n' + newNote);
  } else if (!mine) {
    range.setValue(current + '\n' + text);
    range.setNote(note ? note + '\n' + newNote : newNote);
  }
}

function writeLog(ss, p, sessionId) {
  if (!p || !p.rows) return;
  const sh = logSheet(ss, p.block);
  const tag = 'lift-log:' + sessionId;
  const label = 'Week ' + p.week + (p.deload ? ' (deload)' : '');
  const when = [p.date, p.workout, p.location].filter(String).join(' · ');
  for (const r of p.rows) {
    if (!r.log) continue;
    const row = exerciseRow(sh, r.name);
    const col = weekSlot(sh, row, p.week, label, tag);
    writeCell(sh.getRange(row, col), r.log, sessionId, when + (r.note ? '\n' + r.note : ''));
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
