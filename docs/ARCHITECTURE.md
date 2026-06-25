# Architecture

GoNoGo is a local-first dependency mapping and campaign readiness tool for engineering teams. It visualizes blockers, blocked work, owners, statuses, documentation, and activity around a project or campaign without requiring a backend.

## Runtime Model

The app is intentionally no-build:

- `index.html` defines the app shell and page surfaces.
- `styles.css` is the stable CSS entry point and imports ordered partials from `css/`.
- Ordered classic script tags in `index.html` load the split runtime from `js/`; `app.js` is retained only as a compatibility reference.
- Browser `localStorage` stores all project data under `gtpl-readiness-v1`.

The current JavaScript split uses ordered classic script tags in `index.html`. This preserves the original shared script scope and keeps the app compatible with opening `index.html` from the filesystem.

## File Layout

- `css/00-tokens-base.css`: font stack, tokens, base elements, early app structure.
- `css/10-layout-shell.css`: early canvas shell and app shell visual pass.
- `css/20-map-graph.css`: collaboration/Jira UI sections and graph legibility rules.
- `css/30-inspector-command-bar.css`: soft dashboard shell, command bar, inspector, and layout repairs.
- `css/40-pages-docs-work-projects.css`: My Work, Documentation, Projects, and related page layouts.
- `css/50-components-dropdowns-buttons.css`: dropdown component styles and dependency node component styling.
- `css/60-themes-dark.css`: placeholder for future dark-theme consolidation; dark overrides remain in chronological chunks to preserve cascade.
- `css/99-regression-guards.css`: emergency restore and regression guard rules.
- `css/70-focus-mode.css`: map focus mode and focus-mode dark overrides. This remains after regression guards because that is the current cascade order.

- `js/00-constants-seed.js`: constants, seed data, factories, and blank board creation.
- `js/10-state-storage.js`: load/save/normalize state and undo/redo history.
- `js/20-model-helpers.js`: selection, CRUD helpers, owner helpers, and graph mutation helpers.
- `js/30-readiness-dependencies.js`: dependency traversal, readiness calculation, select population, and dropdown helpers.
- `js/40-layout-engine.js`: layered layout engine and arrange animation.
- `js/50-graph-render-interaction.js`: SVG graph rendering, inspector rendering, report, and export helpers.
- `js/60-inspector-pages.js`: render orchestrator, tables, page renderers, and readiness panels.
- `js/70-forms-events.js`: form handlers, pointer/keyboard handlers, toolbar actions, and initial render call.
- `js/80-init.js`: reserved placeholder for a future module boot path; not active in the current runtime.

## Data Model

State contains these major collections:

- `objects`: blocks on the dependency map, including projects, campaigns, hardware, documents, reviews, tasks, tests, and people/teams.
- `dependencies`: directed links between blocks.
- `projects`: workspace/project definitions.
- `members`: owner/team metadata.
- `layout`: saved SVG canvas node positions.
- `documentation`: per-block summaries, notes, actions, evidence links, and updates.
- `activity`: local activity records.
- `pings`: local owner ping records.

## Dependency Semantics

`dependency(parentId, childId)` means:

- `parentId` is the blocked item.
- `childId` is the blocker that must be ready first.
- The visual flow reads left to right: blocker -> blocked item.

This direction is easy to confuse, so keep it explicit in code comments and future docs.

## Render Pipeline

A typical user action follows this path:

1. User interacts with a form, graph node, toolbar, sidebar, or keyboard shortcut.
2. The handler updates local state.
3. Mutating actions call `rememberState()` where undo history is needed.
4. The app calls `saveState()` after meaningful changes.
5. `renderAll()` refreshes options, tables, graph, inspector, reports, pages, focus mode, and derived counts.

## CSS Cascade Strategy

The CSS has many historical design passes. This refactor preserves chronological cascade order instead of deduplicating or regrouping aggressively. Regression guards stay late because they intentionally override earlier experiments. Focus-mode rules currently load after the regression guards to preserve the pre-refactor computed style.

A future cleanup pass can dedupe and consolidate rules, but that should be done with visual regression screenshots because the cascade is part of the current behavior.
