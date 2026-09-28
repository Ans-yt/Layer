# Canvas/layout/preview contracts

- Geometry and layout functions are pure: callers receive new values and the source page is not mutated.
- Element positions returned by `computeLayout` and `getAbsoluteRect` are page-global; child `x`/`y` values are parent-local.
- Canvas snapping uses page units with a screen-space tolerance (`pixels / zoom`), excludes the moving subtree and ancestors, and resolves ties by distance, priority, source order, then coordinate.
- Operation helpers preserve IDs unless cloning; clone operations return an explicit old-to-new `idMap`.
- Prototype rendering uses React text and native controls only. Imported image and external URLs are scheme-checked before they reach an element attribute or navigation callback.
- `Canvas.onZoom` and prototype callbacks are optional to preserve the existing App prop contract while newer hosts can pass them.
- Export integration: run `node scripts/build-preview.mjs` once before packaging, include generated `public/preview-runtime.js` beside `preview/index.html`, then call `buildPrototypeHtml(safeProject, { runtimeSrc: 'preview-runtime.js' })`; for a literal one-file handoff pass the generated runtime text as `runtimeCode` instead.
- Prototype-only structural fields consumed without changing the legacy model type are `textColor`, `imageFit`, `imagePosition`, `required`, `inputType`, `placeholder`, `options`, `panels`, `body`, `open`, `animation: { x, y, scale, opacity }`, plus responsive entries on `responsive`, `breakpoints`, or `overrides`.
