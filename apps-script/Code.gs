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
 */
const SECRET = 'change-me';

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'Bad JSON' });
  }
  if (data.secret !== SECRET) return reply({ ok: false, error: 'Wrong passphrase' });
  if (data.ping) return reply({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
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

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
