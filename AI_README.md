# AI Notes

Static site prototype for Google-Sheet-backed workout tracking.

Keep this file and `README.md` updated together whenever backend setup, deployment steps, file structure, or data schema changes.

Live site: https://talrme.github.io/workout/

GitHub repo: https://github.com/talrme/workout

## Files

- `index.html`: app UI
- `config.js`: default backend URL and default auto-sync setting
- `styles.css`: phone-friendly styling
- `app.js`: local state, JSONP sync, rendering, and interactions
- `backend.sample.gs`: copy-paste Google Apps Script backend
- `icon.svg`: app icon
- `README.md`: human setup guide
- `AI_README.md`: implementation notes for future Codex passes

## Product Behavior

The app shows:

- Seven workout machines plus planks, grouped into legs, upper body, and core
- A compact table with recent dates as columns
- Dates render newest-to-oldest, with `Today` as the first date column so phone users see the action column immediately
- The latest logged weight per machine/date
- Date headers show a subtle day/date pair, such as `Today` over `9/14`, rather than completion counts
- A soft checkmark in today's column that repeats the previous logged weight
- A green checked weight after today's set is logged; clicking it opens the editor
- Logged values include a small clear button that appends the normal deletion marker and toggles that machine off for today
- Subtle today's notes under logged values, controlled by the browser-local `hideTodayNotes` setting
- Accordion details per machine for setup notes, today's weight, today's note, and deleting today's entry
- Date headers open a whole-day editor for all machine weights/notes on that date
- A plus button beside `Today` opens the same editor on yesterday by default, and the user can change the date
- A bottom `Add workout` row creates custom rows with a section, value label, default value, and setup notes
- Local-only sample history for the previous six days to make a fresh browser feel populated
- `workout-icon.png` plus `manifest.webmanifest` provide the phone/home-screen icon

The UI intentionally hides backend setup and does not show target effort, reps, or reps in reserve. Those older fields can remain in the backend schema for compatibility, but new UI writes only `weight` and `note` for workout logs. Plank duration is stored in the existing `weight` field as a display string such as `30s`, while the UI labels that row as `Time`.

## Backend Model

- Google Sheet-bound Apps Script.
- `backend.sample.gs` exposes `doGet`.
- Static app uses JSONP by adding a `<script>` tag with `action`, `callback`, and optional JSON `payload`.
- Supported actions: `snapshot`, `saveMachine`, `logSet`.

Current table behavior reuses the existing backend without requiring a new Apps Script deployment:

- `Machines.setupNotes` stores static machine setup/seat notes.
- `Logs.weight` stores the displayed weight.
- `Logs.note` stores the note for that machine/date.
- The frontend treats the latest log row for a machine/date as the current value, so editing today's value appends a new row rather than mutating the old one.
- Deleting today's value also appends a log row, but with `note` set to `__WORKOUT_DELETE__` and blank `weight`. The frontend treats that marker as an empty machine/date. This keeps deletion compatible with the original append-only `logSet` action.
- Auto sync is frontend-only: the app syncs on page open, when returning to the foreground, and for a two-minute catch-up window after opening or saving. During that short window it checks every 15 seconds, then stops. Save responses also merge the returned backend snapshot.
- `config.js.defaultBackendUrl` is authoritative on load, so stale localStorage backend URLs do not strand a browser on an old backend.
- Sample rows have `_demo: true`, use IDs beginning with `demo-week-`, and are skipped by `syncLog`, so they stay local and never write to the Sheet. When a real backend is configured or synced, demo rows are removed from local state so they cannot mix with real backend rows.
- Whole-day edits use `appendLogForDate`, which writes the same log shape as today's quick log but with the selected date.
- Whole-day delete appends one deletion marker per default machine for that date.
- Previous-day value chips open the day editor focused on that machine; the per-machine Delete button appends the same deletion marker for that one machine/date.
- Suggested workout highlighting is frontend-only: a row is highlighted when its machine is absent from the last 3 workout dates that have any visible logged value.
- When editing/deleting a day that contains only `_demo` sample logs, the new rows are also marked `_demo` so sample tinkering stays local.
- The `hideTodayNotes` setting lives only in localStorage and does not require backend support.
- Custom workouts are preserved in localStorage. The current Apps Script `Machines` shape can store their id/name/default value/setup notes, but not section/group or value label unless the backend is expanded.

The website talks to:

```text
workout website -> Apps Script Web App URL -> Google Sheet
```

The Sheet does not need to be editable by anyone. The Apps Script deployment should be:

- Execute as: `Me`
- Who has access: `Anyone`

That lets the script write as the owner while the Sheet itself can remain private.

The current permanent default backend is stored in `config.js`:

```js
window.WORKOUT_CONFIG = {
  defaultBackendUrl: ".../exec",
  sheetUrl: "...",
  autoSync: true
};
```

`app.js` uses this only as the initial default. A user's browser-local settings can still override it through localStorage.

## Sheets

`Machines` columns:

- `id`
- `name`
- `targetWeight`
- `setupNotes`
- `updatedAt`

`Logs` columns:

- `id`
- `date`
- `createdAt`
- `profileName`
- `machineId`
- `machineName`
- `weight`
- `reps`
- `effort`
- `rir`
- `note`

The source Google Sheet link is stored in `config.js` as `sheetUrl` and shown in the site footer.

## Setup Flow To Preserve In README

The human README should explain:

1. Create a blank Google Sheet.
2. Open `Extensions -> Apps Script`.
3. Paste `backend.sample.gs` into `Code.gs`.
4. Save with `Cmd + S` or the save icon.
5. Deploy as a web app.
6. Use `Execute as: Me`.
7. Use `Who has access: Anyone`.
8. Authorize permissions.
9. Copy the `/exec` Web app URL.
10. Put that URL in `config.js` as `defaultBackendUrl`.

If the URL should be permanent for fresh browsers, update `config.js` too.

If `backend.sample.gs` changes, the README should also mention redeploying via `Deploy -> Manage deployments -> edit -> New version -> Deploy`.

## Security

This is intentionally simple and permissive for prototyping. Anyone with the Apps Script URL can write to the Sheet via the script. Do not use this for sensitive data without adding authentication or validation.
