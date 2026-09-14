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

- Seven workout machines grouped into legs and upper body
- A compact table with recent dates as columns
- The latest logged weight per machine/date
- A soft checkmark in today's column that repeats the previous logged weight
- A green checked weight after today's set is logged; clicking it opens the editor
- Accordion details per machine for setup notes, today's weight, today's note, and deleting today's entry
- Local-only sample history for the previous six days to make a fresh browser feel populated

The UI intentionally hides backend setup and does not show target effort, reps, or reps in reserve. Those older fields can remain in the backend schema for compatibility, but new UI writes only `weight` and `note` for workout logs.

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
- Sample rows have `_demo: true`, use IDs beginning with `demo-week-`, and are skipped by `syncLog`, so they stay local and never write to the Sheet.

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
