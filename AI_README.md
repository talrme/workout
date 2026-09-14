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

The app tracks:

- Seven workout machines
- Target weight per machine
- Seat/setup notes
- Set logs with date, weight, reps, optional effort, optional reps left in reserve, and notes

Target effort copy is based around RPE 7, or about three reps left in the tank.

## Backend Model

- Google Sheet-bound Apps Script.
- `backend.sample.gs` exposes `doGet`.
- Static app uses JSONP by adding a `<script>` tag with `action`, `callback`, and optional JSON `payload`.
- Supported actions: `snapshot`, `saveMachine`, `logSet`.

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
10. Paste that URL into the workout site settings.

If the URL should be permanent for fresh browsers, update `config.js` too.

If `backend.sample.gs` changes, the README should also mention redeploying via `Deploy -> Manage deployments -> edit -> New version -> Deploy`.

## Security

This is intentionally simple and permissive for prototyping. Anyone with the Apps Script URL can write to the Sheet via the script. Do not use this for sensitive data without adding authentication or validation.
