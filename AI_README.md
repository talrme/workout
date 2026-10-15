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
- `dumbell-2.png`: favicon and phone/home-screen icon
- `README.md`: human setup guide
- `AI_README.md`: implementation notes for future Codex passes

## Product Behavior

- Exercise rows grouped into legs, upper body, core, physical therapy, and other
- Today plus four recent dates, newest first; Show older entries at the far right reveals five more dates, and Recent only restores the initial view
- A subtle empty dashed ring for unlogged workouts; tapping it logs the previous weight
- Completed workouts show a green check and weight; tap the check to uncheck today, or the number to edit
- Every past date cell, including an empty dash, opens the same compact inline editor for that exercise and date
- Inline editors show weight/time and setup notes, with a collapsible More options section for the workout note
- A prominent Save button with smaller Remove and rotating Close icons
- Outside taps save and collapse the open editor before handling the tapped control
- Gentle phone scrolling only when needed to fit the editor in the upper half, accounting for keyboard space and reduced-motion preferences
- Add workout and Add day buttons below the table stay visible during horizontal scrolling
- Add day opens a small date picker; Add column creates a blank date column without inventing workout records. Empty added dates are stored on this device; saved entries sync through the existing Sheet backend
- Workout logo next to the title, and the goal: last 2 reps at effort 7/10, 8/10, and 9/10 across sets 1, 2, and 3
- Settings at the bottom, opening in a vertically centered dialog with keyboard focus containment and Escape support
- Garden, Tide, Moon, and Sunrise color schemes, plus separate controls for workout notes and setup previews
- Advanced settings for profile name, auto sync, reduced motion, Google Sheet link, sync status, and Reset local
- Highlight missed workouts is enabled by default and can be disabled in Settings. It flags exercises missing from all of the last three distinct workout days with visible logs; fewer than three days do not trigger highlights. Disabling it hides both highlights and their legend.
- Preferences persist on this device; theme choices preview and save immediately, while the Save button applies the other settings
- The new dumbbell PNG supplies the favicon and phone icon
- Existing Google Sheet synchronization on open, return to foreground, and short catch-up windows after saving

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
- Legacy placeholder rows are removed from localStorage on load and sync if they have `_demo: true` or ids beginning with `demo-week-`.
- Whole-day edits use `appendLogForDate`, which writes the same log shape as today's quick log but with the selected date.
- Whole-day delete appends one deletion marker per default machine for that date.
- Previous-day value chips open the day editor focused on that machine; the per-machine Delete button appends the same deletion marker for that one machine/date.
- Suggested workout highlighting is frontend-only: a row is highlighted when its machine is absent from the last 3 workout dates that have any visible logged value.
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
