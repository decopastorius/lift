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
- **Set types**: warm-up, working, **myo-reps** (guided), and **lengthened partials** (as separate sets). Each set records weight, reps and RIR.
- **Myo-rep guidance**: after the activation set the app sets a mini-set target of about ⅓ of the activation reps (3–5), starts a 15 s breathing timer, and ends the myo-rep set when a mini-set misses the target (or after 5 mini-sets).
- **Supersets**: give consecutive exercises the same letter. You get a short transition timer between them and the full rest after the round.
- **Timers**:
  - The whole workout is timed.
  - A rest timer starts after every set, with separate defaults for warm-ups, myo mini-sets and superset transitions.
  - The actual rest taken before each set is recorded and sent to the sheet.
- **Google Sheets export**:
  - A `Summary` tab with one row per exercise per workout, plus the suggested target for next time.
  - A `Sets` tab with one row per set.
  - Editing a past workout re-sends it, replacing its rows instead of duplicating them.
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

1. Create a Google Sheet and share it with your coach.
2. In the sheet: **Extensions → Apps Script**. Replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
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
