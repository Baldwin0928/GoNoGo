# Test Checklist

Run from the repo root:

```powershell
py -m http.server 4178 --bind 127.0.0.1
```

Open `http://127.0.0.1:4178/`.

## Load

- No console errors on initial load.
- Map page opens with the soft SaaS shell, sidebar, top cards, graph canvas, and inspector visible.
- Root `styles.css` and `app.js` are thin entry points.

## Map

- Select a block and confirm the inspector shows that block.
- Shift-click two blocks and confirm multi-select inspector behavior.
- Click `Focus campaign`; focus mode enters without overlap.
- Click the full-screen/focus controls and confirm focus mode enters/exits.
- Press `Escape` in focus mode and confirm it exits.
- Leave the map page while in focus mode and confirm the app returns to normal layout.
- Collapse/expand the inspector drawer in focus mode.
- Drag a node and confirm snapping still feels usable.
- Use `Arrange` and confirm the map rearranges without JS errors.
- Use mouse wheel/trackpad pan and Ctrl+wheel zoom.
- Confirm header/command bar has no overlap at 1920px width.
- Confirm header/command bar has no overlap around 1400px width.

## Dependencies And Editing

- Add a connected blocker from the inspector.
- Add a shared blocker for two selected targets.
- Connect existing blocks in connect mode.
- Right-click a block and delete it.
- Use `Ctrl+Z` and redo to restore changes.

## Pages

- Open Documentation and confirm the navigator, document editor, and Block tools render.
- Open My Work and confirm Needs attention, Owned blocks, and Activity feed render.
- Open Teams and Projects pages and confirm forms and lists render.
- Use `Show on map` from Documentation and confirm it returns to the selected block.

## Export And Theme

- Click `Export block diagram` and confirm a download/export is triggered.
- Toggle dark mode and confirm map/docs/work/pages remain readable.
- Toggle back to light mode and confirm the original look returns.

## Final Checks

- No console errors during the interactions above.
- No duplicate monolith copies remain: root `styles.css` and `app.js` should only be entry points.
- `css/` partials and ordered `js/` chunks load successfully.