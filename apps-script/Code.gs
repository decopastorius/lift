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
 * After each workout the app also sends a full backup, saved as a JSON file in the
 * Drive folder below (one file per day; the newest KEEP_BACKUPS are kept).
 * "Restore from Drive" in the app downloads the newest one.
 */
const SECRET = 'change-me';
const BACKUP_FOLDER = 'Lift Log backups';
const KEEP_BACKUPS = 30;

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
