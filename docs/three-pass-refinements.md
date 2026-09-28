# Three small refinement passes

## 1. Toolbar and project controls

- Project and file menus dismiss on outside click or Escape; Escape restores
  focus without clearing the canvas selection. File actions close their menu.
- Projects includes an explicit **Rename current project** action. Rename fields
  select their text, trim names, cancel empty input or Escape, and commit once.
- The current project uses its latest name, even while saving; choosing it does
  not reload an older saved copy.
- Long names truncate, tool modes expose pressed state, and undo/redo/zoom have
  styled hints. Zoom buttons disable at their limits.
- The new-tab action is accurately labeled **Open editor in new tab**.

## 2. Layers

- Search includes nested matches with their ancestor path and a match count.
  Clear or Escape restores the prior expanded/collapsed state.
- Double-click a name or focus it and press **F2** to rename inline. Locked
  layers and locked ancestors are respected.
- Eye/lock controls affect the clicked row, not an earlier selection. The
  current selection stays intact and changes remain undoable.
- Hidden/locked rows keep their status actions visible. Keyboard focus reveals
  row actions; touch devices do not depend on hover.

## 3. Chat and interaction checks

- Finished user/assistant messages have **Copy**. It copies original Markdown,
  announces actual success, and offers manual-copy guidance on failure.
- Native text selection/copy and select-field keys no longer trigger layer
  copying or canvas movement. Working replies expose an accessible status.
- Compact header text no longer overlaps tool buttons, project menus stay above
  the inspector, and canvas controls wrap instead of being clipped.

## Reproduce checks

```sh
npm run build
npm test
npm run test:polish
npm run test:chat
npm run test:e2e
```

Browser scripts expect Layer at `http://127.0.0.1:8787/`; override with
`LAYER_E2E_URL`. `CHROME_PATH` overrides the Windows Chrome executable.
The polish check uses fresh profiles at 1440, 1024 and 540px, empty provider
fixtures, and the isolated browser's real clipboard. Layer-list interactions
run at desktop/compact widths; that sidebar remains hidden at 540px.
Screenshots: `screenshots/micro-fixes/`. No live AI provider is exercised.

The design detector's only advisory is the existing measurement-canvas grid,
which is intentional. These targeted checks do not certify all editor features.
