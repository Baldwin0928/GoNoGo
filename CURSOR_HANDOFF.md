# Cursor Handoff: GTPL Dependency Map

## Project Purpose

This is a local-first engineering dependency mapping tool for GTPL-style campaign readiness. The user wants it to behave less like a spreadsheet/task list and more like a visual block diagram where teams can map blockers, requirements, campaigns, projects, and owners quickly.

The main experience should stay one-page and map-first. The user prefers an intuitive visual board where they can add blocks, drag them, connect them, inspect them, assign owners, and export a readable block diagram.

## Where The App Lives

Live app folder:

```text
C:\Users\chald\OneDrive\Desktop\Dependency
```

Current staging/work folder used by Codex:

```text
C:\Users\chald\OneDrive\Documents\New project\dependency_build
```

Main files:

```text
index.html
styles.css
app.js
assets/img/whitebutterfly.png
README.md
CURSOR_HANDOFF.md
```

This is currently a static frontend app. It can be opened directly from `index.html`. No backend is wired yet.

## Current Stack

- Plain HTML, CSS, and JavaScript.
- Data persists in browser `localStorage`.
- No build step.
- No package manager required.
- The app exports a visual Excel-compatible `.xls` file, not a true CSV-only data dump.

## Current Data Model

`app.js` owns the state.

Core concepts:

- `objects`: blocks on the map.
- `dependencies`: directed relationships between blocks.
- `projects`: large containers/programs.
- `members`: future workspace/team members.
- `pings`: local placeholder log for future email notifications.
- `layout`: saved block positions.

Important direction convention:

```text
Flow reads left to right: blocker -> blocked item
```

In the stored dependency object:

```js
dependency(parentId, childId, relationshipType, notes)
```

For a `requires` relationship:

- `parentId` is the blocked item / downstream thing.
- `childId` is the blocker / upstream thing.

This is slightly unintuitive but already used throughout the app, so be careful when editing graph logic.

## Implemented Features

### Map-first UI

- The dependency map is the main work area.
- Blocks are draggable.
- Blocks snap to a grid/alignment system.
- The map supports zoom in, zoom out, and fit.
- There is no visible spreadsheet-like grid on the map.

### Block creation

- Right panel has inspector tabs:
  - `Selected`
  - `Add blocker`
  - `Blockers`
- Adding a block usually creates it as an upstream blocker for the selected/attached block.
- The add form has an optional `Depends on another block` mode.

### Multi-select shared blockers

Current user request that is implemented:

- Click one block.
- Hold `Shift` and click another block.
- The app stores a multi-selection using `selectedObjectIds`.
- The inspector shows a multi-selected state.
- Clicking `Add shared blocker` lets the user create one new blocker that applies to all selected blocks.
- Connecting from a source handle also respects multi-selected targets.

Relevant functions:

```js
selectedObjects()
setPrimarySelection(id, append)
connectBlockToTargets(blockerId, targetIds)
addDependencyLink(blockedId, blockerId, notes)
```

### Context menu

Right-click an existing block to:

- Add blocker here.
- Connect from here.
- Delete block.

Deletion should be low-friction but still confirms before removing.

### Undo/redo

- `Ctrl+Z` undo.
- `Ctrl+Y` redo.
- `Ctrl+Shift+Z` redo.
- Topbar buttons for Undo and Redo also exist.

### Full reset

- `Reset GTPL seed`: restores the seed/demo board.
- `Full board reset`: clears to a blank campaign.

### Projects and campaigns

There is a `Projects` page, but the user was confused by the distinction.

Intended mental model:

- Project = big container/program/workspace area.
- Campaign = specific readiness gate/map inside a project.
- Blocks belong to a project and connect around selected campaigns.

The distinction probably needs clearer UI language later.

### Teams and future ownership

There is a `Teams` page where the user can add teammates locally.

The intended future behavior:

- Add people by email.
- Owner fields should be assignable/pingable.
- Later, when online backend/email exists, `Ping owner` should send an email or notification.

Currently it only logs pings locally.

### Export

The export is currently called `Export block diagram`.

The user clarified they do not want a plain CSV table. They want an export that visually captures the block diagram and the details. The current export generates an Excel-readable `.xls` document with:

- Summary.
- Visual board columns/rows.
- Block details.
- Dependency links.

Future improvement: make this prettier and closer to the actual visual map.

## Design Direction

The user likes:

- Jira-like clean layout and typography.
- Sharp, clean UI.
- Clear visual block diagram.
- One-page-first experience.
- Intuitive click/drag/connect workflows.
- Toggleable dark mode inspired by tactical/mission-control UI.

The user dislikes:

- Too many pages.
- Soft/rounded/cute styling.
- Confusing blue outlines that make non-selected blocks look selected.
- Spreadsheet-looking CSV dumps.
- Big visible grid backgrounds.
- Scrolling too much in the right panel to get to selected block details.

## Styling Notes

The app currently has a light Jira-like theme plus a separate dark mode layer.

Light mode:

- Jira-ish white background.
- Atlassian-style blue accent.
- Clean panels and thin borders.

Dark mode:

- Toggle button in the top nav.
- Uses `body[data-theme="dark"]`.
- Saved with:

```js
const THEME_KEY = "gtpl-readiness-theme";
```

Dark mode should feel like a clean tactical interface:

- Black/dark panels.
- Thin gray borders.
- High-contrast labels.
- Blue only for selection/focus.
- Amber for connect-source state.
- Red/green status rails.

Important recent styling fix:

- Campaign and Project blocks should not have blue borders by default.
- Blue border should mean actual selected block.

## Key UI Gotchas

### Selection color

Do not use blue borders casually. The user finds that confusing.

Use:

- Blue outline = selected block or active focus.
- Neutral/dark outline = normal campaign/project blocks.
- Left rail = status.

### Dependency direction

Keep visual direction clear:

```text
blocker -> blocked item
```

The user has asked before: "what is blocking what?"

Avoid ambiguous arrows or labels. The current edge label says `BLOCKS`, but this may need a cleaner visual treatment later.

### Add blocker flow

This is one of the most important workflows. It should be obvious which existing block the new block will attach to.

For multi-select:

- The UI should say the new block is a shared blocker for `N selected`.
- It should show the selected target names.

### Right panel

The user dislikes scrolling in the inspector. Keep the selected block controls high up. Prefer tabs or compact sections over long stacked panels.

## Recent Changes To Be Aware Of

1. Added multi-select with `Shift+click`.
2. Added shared blocker creation for multiple selected blocks.
3. Tightened selection styling so only selected blocks are blue.
4. Added toggleable dark mode with saved preference.
5. Kept dark mode as a separate CSS override section at the bottom of `styles.css`.

## How To Test Quickly

Open:

```text
C:\Users\chald\OneDrive\Desktop\Dependency\index.html
```

Test these flows:

1. Toggle `Dark` / `Light` in the top nav.
2. Click a block and confirm only that block is blue.
3. Shift-click two blocks and confirm multi-select inspector appears.
4. Add a shared blocker and confirm it connects to both selected targets.
5. Drag blocks and confirm snapping still feels usable.
6. Right-click a block and delete it.
7. Use `Ctrl+Z` and redo.
8. Export block diagram and open the `.xls` in Excel.

## Suggested Next Improvements

Highest-value UI improvements:

1. Make the right inspector more compact and less scroll-heavy.
2. Make add-block mode even clearer with a visible "attached to these targets" chip/list.
3. Improve arrow/edge design so the dependency direction is instantly obvious.
4. Improve Projects page language because "project vs campaign" is still confusing.
5. Add a better visual export that resembles the actual map more closely.
6. Add more polished dark-mode tuning after looking at it in browser.

Potential future backend:

- Supabase or Firebase for sync.
- Auth/user invites.
- Email notifications for owner pings.
- Real workspace/team membership.

Do not build the online backend yet unless the user explicitly asks. They are currently focused on frontend/UI and local workflow.

