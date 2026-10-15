# AI Notes — Workout

Keep README.md and this file aligned with changes to data, deployment, and product behavior.

The site is static HTML/CSS/JS; its source is hosted at https://github.com/talrme/workout and live at https://talrme.github.io/workout/.

## Ownership and compatibility

The canonical contract and manual upgrade steps are in README.md. `backend.sample.gs` is the full standalone replacement Code.gs, including backup and migration. Never deploy user writes to the old backend: schemaVersion >= 2 is required for non-Tal operations. Legacy requests without userId continue to use Tal. All preexisting unnamed ownership cells migrate to Tal regardless of the old profileName field.

The frontend loads legacy localStorage (`workout-sheet-prototype-v2`) into profiles.tal. Active machines/logs are a projection of the selected profile cache. saveState ALWAYS keeps the legacy top-level machine/log/date/archive fields as Tal so an old frontend/rollback cannot read another user's data as Tal. Global device settings remain separate from user exercise/log data. Profile selection and optional ?user= links are supported.

Responses carry userId and merge only into that profile's cache. A delayed Tal response must never populate another active profile. Default exercises may seed the legacy Tal profile, but never an empty new user. Pending writes persist with their original userId and payload; writes retry after sync. Archived-user pending writes pause until restoration. Creation is server-first with client-generated retry IDs. Archiving the current user selects an active replacement and retains all caches/data. At least one user stays active.

## Migration

setupWorkoutUsers uses a script lock, copies the full spreadsheet before mutations, then appends named headers and owner cells. Original columns/values/IDs are retained. Script properties keyed by spreadsheet ID track the backup URL and schema version. Failed backup aborts before data changes. Setup and create/log operations are retry-safe. Known legacy exercise metadata fills only new blank fields.

On the first successful schema-2 Tal snapshot on a device, a durable outbox imports local-only exercises, logs missing on the server, legacy sections/value labels, and archived exercise IDs. Metadata-only imports preserve server names/notes/weights. That device's archive import happens once; subsequent snapshots treat server archive state as shared. Row archival is a distinct action so a stale normal exercise save cannot unarchive it.

## Product

Shared profiles are not authenticated private accounts. User actions live in Advanced settings. Start empty is default; copying Tal clones active exercises only, with new IDs and no logs. Archive and restore both users and workouts; there is no permanent deletion. Theme/preferences are device-local, blank date columns are per-user device caches, and saved exercises/history/archive states sync. Preserve the compact editors, gentle keyboard-space scrolling, faint empty rings, and centered dumbbell header.

## Validation

node tests/backend-users.test.cjs runs without external dependencies and mocks Apps Script services. It checks backup-before-write, original-cell preservation, ownership, migration retries, user creation/copy, duplicate request IDs, archive/restore, and last-user protection. The task's browser QA also exercises phone/desktop flows, delayed replies, offline retries, fresh-device profile links and archive restoration, and the old backend. Do not test by writing to the real Sheet.

Delete day controls appear below the exercise rows, one subtle trash icon per displayed date. A named, dated confirmation covers the selected user only and includes archived exercises. Deleting appends existing deletion-marker log events, removes the local blank-date column, and never erases the underlying Sheet records. Today stays available for new entries. The most recent deletion per profile can be undone on this browser even after reload; restoration retains weights, notes and legacy effort/reps fields, and skips entries edited again since deletion. No Apps Script change is required.
