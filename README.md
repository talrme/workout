# workout

**Live site:** [https://talrme.github.io/workout/](https://talrme.github.io/workout/)

A tiny static app that uses a Google Sheet as a very simple backend.

It works in two modes:

- Local mode: saves machine setup notes and logs in this browser.
- Google Sheet mode: uses a deployed Google Apps Script URL to read/write a Sheet.

This copy has a default Apps Script backend saved in `config.js`, so a fresh browser should already know which Sheet backend to use. The app UI intentionally hides the backend setup details and links directly to the source Google Sheet in the footer.

## What The App Shows

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
- Preferences persist on this device; theme choices preview and save immediately, while the Save button applies the other settings
- The new dumbbell PNG supplies the favicon and phone icon
- Existing Google Sheet synchronization on open, return to foreground, and short catch-up windows after saving

## Big Picture

The setup is:

```text
workout website -> Apps Script URL -> your Google Sheet
```

Deploying means Google turns your Apps Script into a URL that the website can call.

The Sheet itself can stay private. You do not need to make the spreadsheet editable by anyone. The web app runs as you and writes to the Sheet on your behalf.

## Step 1: Create The Sheet

1. Go to Google Sheets.
2. Create a blank spreadsheet.
3. Name it something like `workout backend`.
4. You do not need to add tabs manually. The script will create `Machines` and `Logs`.

## Step 2: Open Apps Script

1. In that Sheet, click `Extensions`.
2. Click `Apps Script`.
3. A new Apps Script tab opens.
4. You will probably see a file called `Code.gs` with some starter function.

## Step 3: Paste The Code

1. Open `backend.sample.gs` from this folder.
2. Select all of the code in that file.
3. Copy it.
4. Go back to Apps Script.
5. Delete everything in `Code.gs`.
6. Paste the copied code.
7. Click the save icon, or press `Cmd + S`.
8. Give the project a name if prompted, like `workout backend script`.

## Step 4: Deploy It

1. In Apps Script, click the blue `Deploy` button in the top right.
2. Click `New deployment`.
3. Next to `Select type`, click the gear icon or dropdown.
4. Choose `Web app`.

Use these web app settings:

- Description: `workout backend v1`
- Execute as: `Me`
- Who has access: `Anyone`

Then click `Deploy`.

This means anyone with the website/script URL can submit through the app, but they do not need direct edit access to the Sheet itself.

## Step 5: Authorize It

The first time, Google will ask permission.

1. Click `Authorize access`.
2. Pick your Google account.
3. If you see `Google hasn't verified this app`, click `Advanced`.
4. Click `Go to [project name]`.
5. Allow the requested permissions.

This is needed because the script writes to the spreadsheet.

## Step 6: Copy The Web App URL

After deployment, Google shows a URL.

Copy the `Web app URL`. It usually ends in `/exec`.

Use the `/exec` URL, not a `/dev` test URL.

## Step 7: Connect The workout Site

This site now keeps backend details out of the page UI. For the live copy, the default Apps Script URL is already stored in `config.js` and is treated as authoritative, so an old browser-local backend URL will not override it.

If you create a new backend later:

1. Open `config.js`.
2. Replace `defaultBackendUrl` with the new `/exec` Web app URL.
3. Update `sheetUrl` if the source Google Sheet changed.
4. Commit and push the site.

The app should then sync with the Google Sheet.

Older browser-local placeholder rows are stripped from local state during load and sync so stale fake history cannot mix into real Sheet data.

## What Happens After That

When you save setup notes or log today's weight, the website calls your Apps Script URL and then does a short catch-up window: it checks the Sheet about every 15 seconds for two minutes, then stops. The site also syncs on page refresh/open and whenever the browser or phone app returns to the foreground.

The script creates/updates:

- `Machines`: machine setup notes, plus older compatibility fields the site can still read
- `Logs`: dated workout logs. The table uses the latest log row for each machine/date.

Custom workout rows use the existing `Machines` sheet shape, so their name, default value, and setup notes can sync. Their section and value-label preferences are kept in this browser's local state unless the Apps Script backend is expanded later.

Deleting today's entry does not physically remove a row from the Sheet. The site appends a small hidden deletion marker, then treats that machine/date as empty. This works with the original `logSet` backend action, so it does not require a backend redeploy.

The date editor uses the same pattern. Saving a day appends new log rows for changed machine weights/notes. Deleting a day appends deletion markers for each machine on that date.

## If You Later Change The Script

If `backend.sample.gs` changes later, redeploy the script:

1. Paste/save the new script code.
2. Click `Deploy`.
3. Click `Manage deployments`.
4. Click the pencil/edit icon.
5. Choose `New version`.
6. Click `Deploy`.

That keeps the same URL but updates what it does.

## Why Apps Script?

Making a Google Sheet editable by anyone is enough for humans in the browser, but a static website still needs a simple URL it can call. The Apps Script web app is that bridge.

This prototype uses JSONP so the static page can talk to Apps Script without dealing with CORS or authentication.

Google's web app docs describe this deployment model here: https://developers.google.com/apps-script/guides/web

## Security Note

This is intentionally low-security and simple. Anyone with the deployed Apps Script URL can write to the Sheet. Because `config.js` is loaded by the browser, the Apps Script URL is visible to anyone who can view the site files. That is fine for a personal prototype, but not for sensitive data.
