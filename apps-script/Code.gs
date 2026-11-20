/**
 * Lift Log → Google Sheets receiver.
 *
 * Setup (once):
 *  1. Create a Google Sheet to share with your coach.
 *  2. Extensions → Apps Script. Replace the contents of Code.gs with this file.
 *  3. Change SECRET below to any passphrase, and save.
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as: Me      Who has access: Anyone
 *     Authorize when asked, then copy the Web app URL (ends in /exec).
 *  5. In Lift Log → More → Settings, paste the URL and the same passphrase, tap "Test".
 *
 * The app sends one session at a time. Re-sending a session (e.g. after you edit it)
 * replaces its rows instead of duplicating them.
 *
 * Coach's layout: each workout is also written into a block like
 *     [tag] Upper 1 | Sets | Reps | Reps In Reserve | Progression | Rest Time (Min.) | Week 1 | Week 2 ...
 *     h     Seated Row (cable) | 2 | 8-10 | 0-1 | Double | 3-4 | 165 x 12, 12 | RIR 1, 0
 *           (row under the block)                               | 42'
 * The block is found by workout name in ANY tab (so your existing sheet works as long as the
 * exercise names match); if it isn't found it is created in the PROGRAM_TAB tab.
 *
 * After each workout the app also sends a full backup, saved as a JSON file in the
 * Drive folder below (one file per day; the newest KEEP_BACKUPS are kept).
 * "Restore from Drive" in the app downloads the newest one.
 */
const SECRET = 'change-me';
const BACKUP_FOLDER = 'Lift Log backups';
const KEEP_BACKUPS = 30;
const PROGRAM_TAB = 'Program';
const FIRST_WEEK_COL = 8; // column H holds "Week 1"

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'Bad JSON' });
  }
  if (data.secret !== SECRET) return reply({ ok: false, error: 'Wrong passphrase' });
  if (data.ping) return reply({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
  if (data.action === 'getBackup') return reply(loadBackup());

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (data.action === 'backup') return reply(saveBackup(data.backup));
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    upsert(ss, 'Summary', data.summaryHeaders, data.summary, data.sessionId);
    upsert(ss, 'Sets', data.setHeaders, data.sets, data.sessionId);
    if (data.program) writeProgram(ss, data.program, data.sessionId);
    return reply({ ok: true });
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
  // Remove existing rows for this session (column A = Session ID), bottom-up in blocks.
  const last = sh.getLastRow();
  if (last > 1) {
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
  if (rows && rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }
}

// ---------- coach's layout ----------

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');

function findBlock(sh, workout) {
  const lastRow = sh.getLastRow();
  if (!lastRow) return null;
  const vals = sh.getRange(1, 1, lastRow, Math.max(3, sh.getLastColumn())).getDisplayValues();
  for (let r = 0; r < vals.length; r++) {
    if (norm(vals[r][1]) !== norm(workout) || norm(vals[r][2]) !== 'sets') continue;
    const rows = {};
    let last = r + 1;
    for (let i = r + 1; i < vals.length; i++) {
      if (!String(vals[i][1]).trim() || norm(vals[i][2]) === 'sets') break;
      rows[norm(vals[i][1])] = i + 1;
      last = i + 1;
    }
    return { sh, header: r + 1, rows, last };
  }
  return null;
}

function createBlock(ss, p) {
  const sh = ss.getSheetByName(PROGRAM_TAB) || ss.insertSheet(PROGRAM_TAB);
  const start = sh.getLastRow() ? sh.getLastRow() + 2 : 1;
  const values = [['', p.workout, 'Sets', 'Reps', 'Reps In Reserve', 'Progression', 'Rest Time (Min.)']]
    .concat(p.rows.map((r) => [r.tag, r.name, r.sets, r.reps, r.rir, r.progression, r.rest]));
  const range = sh.getRange(start, 1, values.length, 7);
  range.setNumberFormat('@'); // keep "8-10" from turning into a date
  range.setValues(values);
  sh.getRange(start, 1, 1, 7).setFontWeight('bold');
  return findBlock(sh, p.workout);
}

function weekColumn(block, week) {
  const sh = block.sh;
  const width = Math.max(sh.getLastColumn(), FIRST_WEEK_COL);
  const header = sh.getRange(block.header, 1, 1, width).getDisplayValues()[0];
  for (let i = FIRST_WEEK_COL - 1; i < header.length; i++) {
    const m = String(header[i]).match(/^\s*week\s*(\d+)\s*$/i);
    if (m && Number(m[1]) === week) return i + 1;
  }
  let col = FIRST_WEEK_COL + week - 1; // Week N normally sits N-1 columns right of Week 1
  if (col <= header.length && String(header[col - 1]).trim()) {
    // taken by another header: use the first free column after the last header
    let filled = header.length;
    while (filled > 0 && !String(header[filled - 1]).trim()) filled--;
    col = Math.max(filled + 1, FIRST_WEEK_COL);
  }
  const cell = sh.getRange(block.header, col);
  cell.setValue('Week ' + week);
  cell.setFontWeight('bold');
  return col;
}

/** Write a log cell; the note remembers which workout wrote it so a re-send replaces it. */
function writeCell(range, text, sessionId) {
  const tag = 'lift-log:' + sessionId;
  const note = range.getNote();
  const current = range.getDisplayValue();
  range.setNumberFormat('@');
  if (!current || note === tag || current === text) {
    range.setValue(text);
    range.setNote(tag);
  } else if (note.indexOf(tag) === -1) {
    // a second workout in the same week: keep both
    range.setValue(current + '\n' + text);
    range.setNote(note ? note + '\n' + tag : tag);
  }
}

function writeProgram(ss, p, sessionId) {
  if (!p || !p.workout) return;
  let block = null;
  for (const sh of ss.getSheets()) {
    if (sh.getName() === 'Summary' || sh.getName() === 'Sets') continue;
    block = findBlock(sh, p.workout);
    if (block) break;
  }
  if (!block) block = createBlock(ss, p);
  // add exercises the block doesn't have yet (e.g. created mid-workout)
  for (const r of p.rows) {
    if (block.rows[norm(r.name)] || !r.log) continue;
    block.sh.insertRowAfter(block.last);
    const row = block.sh.getRange(block.last + 1, 1, 1, 7);
    row.setNumberFormat('@');
    row.setValues([[r.tag, r.name, r.sets, r.reps, r.rir, r.progression, r.rest]]);
    block = findBlock(block.sh, p.workout);
  }
  const col = weekColumn(block, p.week);
  for (const r of p.rows) {
    if (r.log && block.rows[norm(r.name)]) writeCell(block.sh.getRange(block.rows[norm(r.name)], col), r.log, sessionId);
  }
  // session time goes in the row right under the block, if that row is free
  const below = block.sh.getRange(block.last + 1, 2);
  if (p.duration && !String(below.getDisplayValue()).trim()) {
    writeCell(block.sh.getRange(block.last + 1, col), p.duration, sessionId);
  }
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
