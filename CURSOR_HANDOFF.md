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

---

## Deploy GoNoGo as a shared, cloud-hosted, multi-user readiness workspace.

Context:
This app is a dependency-first engineering readiness workspace. A dependency map shows blocks such as Projects, Campaigns, Tasks, Tests, and Reviews. Its core value is the recursive readiness verdict: it walks the full dependency tree and rolls anything not `Ready`/`Complete` into a single campaign-level "are we go?" answer. Today the entire app is a no-build static frontend, and all state is a single JSON blob stored in browser `localStorage` under `gtpl-readiness-v1`. There is no backend.

New feature concept:
The app needs to become a shared, multi-user tool so a team (~15–50 people, mixed technical levels) can all work on the same campaign and see live updates. The readiness verdict (and any future AI) is only trustworthy if owners keep their own blocks current, which is impossible while every person has a private local copy. The end state is a cloud-hosted app reachable at a URL, where everyone signs in and edits one shared board in real time.

Main product rule:
Do not turn this into "a smaller Jira." Every change must pass one test: does this make the go/no-go answer faster, clearer, or more trustworthy? If not, it is scope creep. Keep the map-first, one-page, no-build feel.

Mental model:

* Block = the work item people depend on
* Readiness verdict = the product (the thing competitors do not produce)
* Shared backend = one source of truth so the verdict reflects reality
* Auth = who is allowed to see/edit, and who changed what
* Realtime = everyone sees the same board live
* Local fallback = the app still opens and works if the backend is unreachable

This session was discussion/planning only. No app code was changed (only this handoff was written). Do not start building until the user explicitly greenlights it.

1. Replace localStorage-only persistence with a shared backend.

Adopt Supabase (managed Postgres + Auth + Realtime). Frontend stays static and hosts on Netlify / Vercel / Cloudflare Pages. Keep the no-build approach: load the Supabase client via a script/CDN tag in `index.html`.

2. Start with the shared-blob model, not normalized tables.

First implementation should be the minimal rewrite:

* Store the whole state object as a single row (JSON column) in Supabase, keyed by a shared board id.
* Rewrite `loadState()` and `saveState()` in `js/10-state-storage.js` to read/write that row instead of (or in addition to) localStorage.
* Debounce saves to reduce write churn.

Accept last-write-wins for v1. Go/no-go editing is bursty and low-concurrency (owners occasionally update a block; the lead reviews before a gate), so simultaneous-edit collisions are rare and acceptable for now.

Do NOT build normalized per-row tables yet. That is a later upgrade (see step 12), only if real concurrent-edit pain shows up.

3. Add real-time sync.

Subscribe to Supabase Realtime on the shared board row. When a remote change arrives, reload state and call `renderAll()`. Guard against clobbering an in-progress local edit (e.g. skip/merge while the user is actively dragging or typing).

4. Keep a local/offline fallback.

The app should still open and function if Supabase is unreachable:

* Keep localStorage as a cache/fallback store.
* On load, hydrate from backend when available, otherwise fall back to localStorage seed/state.
* Never let a network failure produce a blank or broken board.

5. Add authentication.

Use Supabase email magic-link auth (no passwords — important for non-technical teammates).

* Gate the board so it only loads after sign-in.
* Restrict access to the team's email domain via Row Level Security so only authorized users can read/write the shared board.
* Sign-in should be one screen: enter work email, click the link, you're in.

6. Stamp edits with user identity.

Record the signed-in user on meaningful mutations (created/updated by + timestamp). This is cheap now and sets up the history/audit log and AI features later. Reuse existing owner/member concepts where possible.

7. Deploy frontend and backend.

* Push the static files to Netlify/Vercel/Cloudflare Pages to get an HTTPS URL.
* Create the Supabase project, apply RLS, and wire the project URL + anon key into the frontend config.
* Share the URL with the team.

8. Add a lightweight "ask the board" AI read demo.

This can precede or follow the full backend and is a high-value, low-cost investor demo. At MVP scale the whole board fits in an LLM context window, so no vector DB is needed.

* Serialize the current state (objects, dependencies, statuses, owners) to JSON.
* Send it to an LLM with a question like "Why are we no-go?" or "What is the critical blocker chain?"
* Render the plain-English explanation of the blocker chain.

Keep it read-only for the first version (AI explains, does not mutate).

9. Refactor mutations into a clean action/command layer.

This is the single most valuable architectural prep for future AI actions — more than the database choice. Today mutations are tangled inside DOM event handlers in `js/70-forms-events.js`.

* Extract discrete, named functions: `addBlock`, `linkDependency`, `setStatus`, `addSharedBlocker`, `createRevision`, etc.
* Both the UI and (later) an AI agent call the same action API.
* Seeds already exist to build on: `connectBlockToTargets`, `addDependencyLink`, `calculateReadiness`.

10. Add an event/history log.

Add an append-only record of meaningful changes (what changed, by whom, when). This directly serves the "trust the verdict" goal — answering "what changed since last review" and "why did readiness flip." Keep it simple: a list of events tied to blocks/board, not full audit tooling.

11. Preserve the current design style.

All new UI (sign-in screen, sync/status indicators, AI panel) must match the existing product styling:

* clean Jira-like light theme + the existing dark mode
* rounded panels, soft shadows, pill chips, thin borders, muted secondary text
* calm status colors (blue = selection/focus only; amber = connect-source; red/green = status rails)
* no dense admin tables, no harsh default browser UI
* keep the map-first, one-page experience; avoid adding pages

12. Keep it lightweight; do not overbuild.

First implementation priorities, in order:

* shared backend persistence (blob)
* auth gate + domain restriction
* realtime sync + local fallback
* edit stamping

Only after that, and only if needed: normalized per-row tables for true concurrent editing, then Supabase pgvector (semantic search over past campaigns) and Edge Functions (server-side LLM calls) for AI at scale. Do not build these for the investor MVP.

13. Hosting cost reference (current as of 2026-06-26).

50 users is tiny for Supabase (billed on monthly-active-users / DB size / egress, not seats — comically under free limits).

* Free ($0): fully functional, but projects pause after 1 week of inactivity (bad for episodic gate reviews / live demos) and no backups.
* Pro ($25/mo flat): never pauses, daily backups (7-day), custom domain, email support. Buys reliability, not capacity.
* Team ($599/mo): SOC2/SSO — ignore until enterprise sales.
* Frontend hosting stays $0 at this scale.

Recommendation: Free while building; $25/mo Pro once the team relies on it or for scheduled investor demos. Note: GitHub backs up code, not the live data — Supabase backups (or a DIY nightly JSON export) cover the data.

14. Overall desired result.

The team should be able to:

* open one URL and sign in with their work email
* edit a single shared campaign and see each other's changes live
* trust that the readiness verdict reflects the current real state
* keep using the app even if the backend is briefly unreachable
* (demo) ask the board in plain English why it is no-go

This turns GoNoGo from a single-user local prototype into a shared readiness workspace a real team can depend on, while staying map-first and keeping the door open for AI suggestions and actions.

