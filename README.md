# GTPL Engineering Readiness

This is a local, dependency-first readiness tracker for GTPL hardware campaigns.

Open `index.html` in a browser. The app is a canvas-first dependency workflow and stores changes in browser `localStorage`, so it does not need a backend for the first prototype.

## What it does

- Uses the dependency map as the primary interface.
- Adds classified blocks directly from the inspector under the selected map block.
- Selects blocks on the canvas for editing.
- Deletes blocks from the map with right-click `Delete block`.
- Connects blocks visually with connect mode.
- Shows arrow direction for `requires` relationships from parent block to required block.
- Supports demo-data reset and full board reset to a blank starter campaign.
- Shows campaign health, blockers, and next actions beside the map.
- Keeps detailed tables, dependency rules, and report in collapsible sections.
- Tracks owners and statuses with inline editing.
- Calculates campaign readiness recursively.
- Lists blockers for the selected campaign.
- Shows a compact dependency map.
- Exports a plain-text readiness report.

## Readiness rule

An item counts as ready only when its status is `Ready` or `Complete`.

For a campaign, the app recursively walks every dependency and marks anything else as a blocker.

## Files

- `index.html` - App shell and screens.
- `styles.css` - Jira-like product UI styling.
- `app.js` - Data model, local storage, dependency traversal, readiness logic, rendering.

## Suggested next upgrades

- Replace `localStorage` with SQLite or a tiny API once multiple users need shared data.
- Add event logs for status history.
- Add revision/change-impact rules after GTPL has real campaign data in the system.
