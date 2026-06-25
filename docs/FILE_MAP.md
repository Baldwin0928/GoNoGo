# File Map

## CSS

| Old monolith section | New file path | Primary responsibility |
| --- | --- | --- |
| Lines 1-643: font stack, first `:root`, base shell and controls | `css/00-tokens-base.css` | Tokens, base document styles, early app scaffolding |
| Lines 644-1557: Canvas-first visual system and GTPL website visual pass | `css/10-layout-shell.css` | Early canvas/app shell styling in original cascade order |
| Lines 1558-3199: collaboration pages, Jira UI pass, graph legibility | `css/20-map-graph.css` | Collaboration surfaces, Jira-style pass, graph/card legibility |
| Lines 3200-4587: soft dashboard shell, layout repairs, product polish | `css/30-inspector-command-bar.css` | Soft shell, top nav, command bar, inspector, map workspace repairs |
| Lines 4588-5453: My Work and Documentation refinement blocks | `css/40-pages-docs-work-projects.css` | Owner dashboard, documentation workspace, project/team page polish |
| Lines 5454-5841: custom dropdowns and dependency node redesign | `css/50-components-dropdowns-buttons.css` | Dropdown/listbox styling and SVG node component styling |
| Placeholder | `css/60-themes-dark.css` | Reserved for future dark-theme consolidation; no rules moved here yet to avoid cascade drift |
| Lines 5842-6099: emergency restore and regression guard blocks | `css/99-regression-guards.css` | Last-mile shell restoration and responsive guard rules |
| Lines 6100-end: dependency map focus mode | `css/70-focus-mode.css` | Focus-mode layout and focus-mode dark overrides |

Note: `70-focus-mode.css` currently imports after `99-regression-guards.css` because that matches the pre-refactor rule order. Do not reorder until visual regression testing exists.

## JavaScript

| Old monolith section | New file path | Primary responsibility |
| --- | --- | --- |
| Lines 1-217 | `js/00-constants-seed.js` | Constants, seed data, factories, blank board |
| Lines 218-394 | `js/10-state-storage.js` | State loading, normalization, save, undo/redo |
| Lines 395-672 | `js/20-model-helpers.js` | Selection, CRUD, owner helpers, graph mutation helpers |
| Lines 673-775 | `js/30-readiness-dependencies.js` | Dependency traversal, readiness, select/dropdown helpers |
| Lines 776-1303 | `js/60-inspector-pages.js` | `renderAll()`, tables, page renderers, readiness panels |
| Lines 1304-1699 | `js/40-layout-engine.js` | Sugiyama-style layered layout and arrange animation |
| Lines 1700-2249 | `js/50-graph-render-interaction.js` | SVG graph rendering, inspector, report/export helpers |
| Lines 2250-end | `js/70-forms-events.js` | Submit/change/input/pointer/click/key handlers and initial `renderAll()` |
| New | `js/80-init.js` | Reserved placeholder for a future module boot path; inactive now |

## Shell Items

`Create` is wired to `createProjectShortcut` and opens Projects.

The following shell items have no direct handlers in this pass: topnav Apps, Notifications, global Search, sidebar For you, and sidebar More spaces. They were left in place to preserve visual parity for this structural-only refactor.