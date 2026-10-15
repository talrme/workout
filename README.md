# Workout

**Live site:** https://talrme.github.io/workout/

A phone-friendly workout tracker backed by Google Sheets and Apps Script.

## Upgrade to users

1. Open the existing workout spreadsheet and choose **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with the complete `backend.sample.gs` file and save.
3. Select **setupWorkoutUsers** in the function dropdown and click **Run**. Authorize if prompted. Wait for **Execution completed**.
4. Choose **Deploy → Manage deployments**, select the existing Web app deployment, and click the pencil icon. Under Version choose **New version**, then **Deploy**. Keep the current access and execution settings.
5. Refresh Workout. If automatic sync is off, open **Settings → Advanced settings → Check connection**.

Do not create a new deployment or change `config.js`; updating the existing deployment keeps its URL.

The setup function copies the complete spreadsheet BEFORE adding any tabs or columns. If the copy fails, migration stops. Its execution log includes the backup URL; the website also links to it in Advanced settings after the upgrade.

Migration adds a Users tab and appends named columns to Machines and Logs. All existing records with no owner become Tal's. Existing record IDs, dates, weights, setup notes, log notes, and deletion markers are retained. Re-running setup does not duplicate data or backups. It does not permanently delete anything.

Existing clients without a user ID continue to read and write Tal only. The website keeps new-user controls disabled until a schema-version-2 snapshot confirms the new backend is running.

## Users

Advanced settings contains the current-user dropdown, Add user, Archive current user, and Archived users / Restore. New users can start empty (default) or copy Tal's active exercises with setup notes and starting weights but no history. Every copy has independent exercise IDs.

These are shared profiles, not private authenticated accounts. Anyone with the link can switch users. Each device remembers its selection; `?user=USER_ID` opens a profile directly. Appearance/preferences are still device-local. Blank added date columns are cached separately per profile on each device; saved entries sync through the Sheet.

Archiving a user keeps their exercises and history intact. At least one user must remain active. Archiving/restoring exercise rows syncs after the upgrade; the browser's pre-upgrade Tal archive choices are uploaded once on its first successful Tal sync.

The first upgraded Tal sync also imports local-only exercises, missing logs, and section/value-label metadata. Metadata-only imports do not overwrite existing server names, weights, or setup notes. Durable pending writes are scoped to the originating user and retry on subsequent syncs; switching profiles cannot send a save to another user. A pending indicator appears in Advanced settings if a write fails.

## Workout interface

- Centered title between two dumbbells; no visible machine-column label.
- Today and four recent dates, with Show older entries at the far right.
- Faint empty rings log the previous weight. Solid checkmarks uncheck today; numbers open the editor.
- Every past cell, including an empty dash, uses the same compact inline editor.
- Weight/time and setup notes stay prominent; workout notes live under More options.
- Save is prominent; small Remove and Close controls share its row. Outside taps save and collapse the editor.
- Phone scrolling happens gently only when needed, accounting for keyboard space and reduced motion.
- Add workout and Add day stay below the horizontally scrolling table.
- A subtle trash icon at each row's far-right end archives it after named confirmation. Undo and Settings → Advanced → Archived workouts restore it with history.
- Highlight missed workouts flags exercises absent from the last three recorded workout dates; it can be disabled in Settings.
- Four color schemes, note visibility, and other device preferences persist locally. Reset to default settings preserves profiles, workout data, pending saves, archived rows, and the Sheet connection.

## Backend contract

Users: id, name, archived, createdAt, updatedAt.

Machines: original columns plus userId, group, valueLabel, seedWeight, archived.

Logs: original columns plus userId. Entry removal remains an append-only log with note `__WORKOUT_DELETE__`.

Actions: snapshot, saveMachine, logSet, createUser, setUserArchived, setMachineArchived. JSONP is used for GitHub Pages compatibility. Requests without a userId default to Tal. The script validates exercise ownership and makes log IDs and create-user retries idempotent. Normal exercise saves cannot silently overwrite archive state.

## Verification

Run the standalone migration/ownership tests with:

```sh
node tests/backend-users.test.cjs
```

Phone and desktop browser checks also cover migration from old browser data, empty/copied users, user switching, current and historical edits, cross-device archive restoration, remembered profile links, stale-response isolation, offline retry ownership, and compatibility with the previous backend. Tests use simulated Sheets and do not modify live workout records.

## Initial setup (only for a new spreadsheet)

Create a spreadsheet, open Extensions → Apps Script, paste `backend.sample.gs`, run `setupWorkoutUsers`, and deploy as a Web app executing as you with access set to Anyone. Put the resulting `/exec` URL and spreadsheet URL in `config.js`. The spreadsheet itself can stay private; the script runs as its owner.

## Recovery

The pre-upgrade spreadsheet copy is a separate file, not a live second backend. If migration fails, do not clear browser data or create replacement tabs; keep the execution error and investigate against the backup. Existing Apps Script deployment versions remain available for rollback. The browser storage format keeps Tal's top-level data compatible with the old website; additional profiles live in separate caches.

Google deployment instructions: https://developers.google.com/apps-script/guides/versions
