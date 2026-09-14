# workout

**Live site:** [https://talrme.github.io/workout/](https://talrme.github.io/workout/)

A tiny static app that uses a Google Sheet as a very simple backend.

It works in two modes:

- Local mode: saves machine targets and logs in this browser.
- Google Sheet mode: uses a deployed Google Apps Script URL to read/write a Sheet.

This copy has a default Apps Script backend saved in `config.js`, so a fresh browser should already know which Sheet backend to use. You can still override that URL in the site settings on a specific browser.

## What The App Tracks

- Seven machines
- Target weight for each machine
- Seat/setup notes
- Set logs with date, weight, reps, optional effort, optional reps left in reserve, and notes

The target effort is roughly RPE 7, or about three reps left in the tank. You can log effort/RIR only when you care.

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

## Step 7: Paste It Into The workout site

1. Open the workout website.
2. Click the settings button in the top-right.
3. Paste the Apps Script URL into `Google Apps Script URL`, or confirm the default URL from `config.js` is already filled in.
4. Put your profile name, like `Tal`.
5. Click `Save`.

The app should then sync with the Google Sheet.

## What Happens After That

When you click `Sync`, `Save`, or `Log set`, the website calls your Apps Script URL.

The script creates/updates:

- `Machines`: target weights and setup notes
- `Logs`: dated workout logs

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
