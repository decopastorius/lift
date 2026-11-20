# Lift Log

An offline-first weight training logger for iPhone, built as an installable web app (PWA).
All data lives on your phone. Finished workouts are copied to a Google Sheet for your coach
whenever you're online, but logging never depends on the sheet.

## Features

- **Works offline**: install it to the Home Screen and it runs with no connection.
- **Locations**: Home, Cottage, Travel, plus any you add, each with its own equipment list.
- **Named templates**: build workouts like "Upper A – Home", start them, and repeat them. You can also start an empty workout and save it as a template at the end.
- **Double progression per exercise**, whatever the location:
  - Add weight after **two sessions at the top of the rep range** (every working set reaches the top, at the same load), **or** after **two sets above the range in one session**.
  - RIR is recorded but doesn't affect progression.
  - Otherwise the app keeps the load and suggests one more rep per set.
  - Warm-ups, partials and back-off sets are ignored. If an exercise was done only as myo-reps, its activation set counts.
- **Equipment setup** per exercise per location (equipment, seat height, bench angle, pins, grip…). It's shown on the exercise card during a workout.
- **Exercise library**: comes with a starter list, you can bulk-import your own (`Name, Category, 8-12, 5, bw`), and you can create exercises in the middle of a workout.
- **Tap to log**: tapping a set's weight, reps or RIR opens a panel of options to tap (loads in steps around the suggestion, with ◀ ▶ to shift; reps around the range with the target highlighted; RIR 0–5), each with a box to type in, and a **Log set** button.
- **Quick notes**: preset notes for exercises and the session (editable in More), plus free text. In the coach's sheet they appear as a cell note on that week's entry.
- **Rest timer defaults**: 3:00 for compound movements and 1:30 for isolation (each exercise has a "Compound movement" switch; both times are adjustable in More → Rest timer). The coach's rest range (e.g. "3-4 min") is shown on the card as the prescription.
- **History tab**: every finished workout, grouped by program week and filterable by location. Open one to review or correct it (changes re-sync), repeat it, save it as a template, or **delete** it. A deleted workout is also removed from the Google Sheet (Summary/Sets rows and its cell in the coach's grid), including when you're offline, on the next sync.
- **Templates**: Templates tab → tap one to edit, duplicate or delete it (past workouts are kept).
- **Set types**: warm-up, working, **myo-reps** (guided), and **lengthened partials** (as separate sets). Each set records weight, reps and RIR.
- **Myo-rep guidance**: after the activation set the app sets a mini-set target of about ⅓ of the activation reps (3–5), starts a 15 s breathing timer, and ends the myo-rep set when a mini-set misses the target (or after 5 mini-sets).
- **Supersets**: give consecutive exercises the same letter. You get a short transition timer between them and the full rest after the round.
- **Start set / Done**: the bar at the bottom of a workout shows the rest timer and the next set, with **▶ Start set**. During the set it shows the set time and **■ Done**; Done timestamps the end and opens the panel to enter reps (the next rest starts from Done).
  - Each set records the **actual rest** (previous Done → Start), the **planned rest**, and the **set duration**.
  - Plain ✓ still works: the rest is then estimated (gap minus ~40 s) and marked estimated.
  - The Progress tab points out when a stall or regression came with a rest notably shorter than planned.
- **Timers**:
  - The whole workout is timed.
  - A rest timer starts after every set, with separate defaults for warm-ups, myo mini-sets and superset transitions.
  - The actual rest taken before each set is recorded and sent to the sheet.
- **Google Sheets export**:
  - A `Summary` tab with one row per exercise per workout, plus the suggested target for next time.
  - A `Sets` tab with one row per set.
  - Editing a past workout re-sends it, replacing its rows instead of duplicating them.
- **Progress tab**: weekly hard sets per muscle and fatigue signals.
  - **Counting:** primary muscle = 1 set, secondary = ½. A myo-rep activation set = 1, each mini-set = ⅓. Lengthened partials:
    - **A set of their own** (rested, taken close to failure) = **1 set**. Training the stretched part of the range has grown muscle at least as well as full range of motion (leg extension and calf studies; 2023 meta-analysis).
    - **Partials straight after failure** (logged within 30 s of a set of the same exercise, or chosen in the set panel) = **⅓**, like a myo mini-set. The coach's log marks them "Partials (after failure)".
    - Partials count for the **main muscle only** by default (in the stretched range the helpers do little), and must be hard sets like any other. An exercise done only as partials progresses on its partial sets. Sets logged above RIR 4, and warm-ups, don't count. All adjustable in More → Volume counting; each exercise's muscles can be edited on its page.
  - **Progression, judged the double-progression way** (e1RM would penalise every earned load jump): each exposure is compared with the previous one, deloads skipped. *Progress* = load up, or more reps or easier at the same load. *Flat* = same. *Grind* = same output but lower RIR. *Regress* = fewer reps, or load down.
  - **Flags:** *stalled* = 3 in a row without progress. *Regressing* = 2 of the last 3 backwards. *Grinding* = effort rising while output is flat. A whole-body signal fires when ≥30% of recent exercises are stalled or regressing. A muscle is flagged when its weekly sets rose ≥20% while one of its main exercises stalls or regresses. Another flag fires when the share of exercises progressing falls three weeks in a row.
  - **Charts:** weekly hard sets and the share of exercises progressing, as two aligned charts (deload hatched). Sets per muscle for any week, with the breakdown by exercise. A muscle × week grid. Every exercise's status and recent history.
- **Coach's sheet log**: each workout is written to a log tab per block ("Block 2 log", "Block 3 log", ...). It has a row per exercise and "Week N" columns along the top, in the coach's format `165 x 12, 12 | RIR 1, 0`. An exercise done twice in a week gets a second "Week N" column, so where you trained or how sessions were split doesn't matter. Each cell's note says when and where, plus your notes. The coach's own "Block N" tabs are only read (for the import), never changed.
- **Program and templates**: Upper 1, Lower 1 and Upper 2 come preloaded for Home and Cottage (from the sheet's h / c / hc tags). Each item has its sets, rep range, target RIR and rest range. The rest timer goes off at the low end of the range.
- **Import from the coach's sheet** (More → Coach's program sheet):
  - paste the program straight from Google Sheets;
  - it updates exercises, rep ranges and templates;
  - weeks already logged become history, so progression starts from real numbers;
  - **or paste just one week's column** (values only, with the "Week N" lines); the values are lined up with the program's rows using the h / c tags, and the preview shows exactly where each one went.
- **Blocks and deload**: 8-week blocks (adjustable in More). Week 8 is a deload: same exercises and sets, RIR 3–4 on everything, last loads, and it doesn't count toward progression. Then week 1 of the next block, written to the next "Block N log" tab.
- **Import from Google Sheet** (More → Coach's program sheet): reads every "Block N" tab (all logged weeks, deloads included) and the equipment-settings tab through the script, and turns them into history, the program, templates and per-location exercise setups. Running it again replaces what it imported before.
- **Weeks**: a week is one round of the program. Each workout gets the week after the last one logged with the same name (e.g. Upper 1 after week 7 → week 8). You can change it at the top of the workout or in its history page.
- **Every finished workout is automatically**:
  - **exported to the Google Sheet**, and
  - **backed up to Google Drive**: a full JSON backup in a `Lift Log backups` folder, one file per day, last 30 days kept.

  Both are queued if you're offline and sent as soon as you're back online. The screen after a workout shows ✓ for each.
- **Restore** from the latest Drive backup (e.g. on a new phone) or from a backup file saved on the phone.

## Install on iPhone

1. Open the app's URL in **Safari**: `https://<your-github-username>.github.io/<repo-name>/`.
2. Tap **Share → Add to Home Screen**.
3. Open it from the Home Screen icon. From then on it works offline.

> iOS keeps data for Home Screen apps; plain Safari tabs can be cleared after weeks of non-use.
> Use the installed app. With the Google Sheet connected, every workout is also backed up to Google Drive.

**Rest-timer sound:** iPhones mute web audio when the ring/silent switch is on silent, and web apps
can't alert you while the phone is locked. Keep the app open during a workout. The screen stays awake
by default (More → Rest timer).

## Google Sheet + Drive backup setup (once, about 5 minutes)

The app never signs in to Google. The script below is installed *inside* one spreadsheet, and its web-app URL writes to that spreadsheet, running as you. Install it in the coach's sheet, which you need edit access to. More → Google Sheet then shows which sheet you're logging to.

1. Create a Google Sheet and share it with your coach.
2. In the sheet: **Extensions → Apps Script**. Replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) (or in the app: More → Google Sheet → **Copy the script**).
3. Change `const SECRET = 'change-me'` to a passphrase of your choice, then save.
4. **Deploy → New deployment**, choose type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Authorize it when asked (you may need "Advanced → Go to project"). It asks for access to
   Sheets (to write the workout rows) and Drive (to save the backups).
5. Copy the **Web app URL** (it ends in `/exec`).
6. In Lift Log, go to **More → Google Sheet**, paste the URL and the passphrase, and tap **Test**.

If you edit the script later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## Hosting (GitHub Pages)

The workflow in `.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`.
Turn it on once: repo **Settings → Pages → Source: GitHub Actions**.

When you release changes, bump `VERSION` in `sw.js`. Phones then download the new files and show a
"New version ready" banner.

## Development

No build step and no dependencies. The UI uses Preact + htm, vendored in `src/vendor/`.

```sh
npm test          # unit tests for progression, myo-reps, session flow, sheet rows
npm run serve     # http://localhost:8080
```

| File | Purpose |
| --- | --- |
| `src/progression.js` | Set types and the double-progression rule |
| `src/myo.js` | Myo-rep guidance |
| `src/session-logic.js` | Planning, logging, rest targets, finishing a workout |
| `src/sheets.js` / `src/sync.js` | Sheet rows and the sync queue |
| `src/store.js` / `src/db.js` | In-memory state saved to IndexedDB |
| `src/views/*` | Screens |
| `apps-script/Code.gs` | The Google Sheet receiver |
