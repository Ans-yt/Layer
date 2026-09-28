# Layer package format

Layer exports a ZIP archive with the `.layer.zip` suffix. The archive is
designed to be inspectable without Layer and to be safe to hand to a builder
or another implementation agent.

```text
design.layer.json       validated document (format `layer`, version 2)
brief.md                readable implementation brief derived from the pages
schema.json             machine-readable package/document notes
LICENSES.md             source and license metadata for every asset
assets/manifest.json    embedded paths, source URLs, and asset metadata
assets/*                 embedded images, icons, and font files when available
preview/index.html       standalone multi-page responsive preview
screenshots/*           optional still captures supplied to the exporter
screenshots/manifest.json optional capture metadata
```

## Document safety

`readLayerFile` validates JSON before it is placed in editor state. It checks
finite numeric ranges, bounded arrays/strings/assets, safe identifiers, page
and element references, parent cycles, external URL schemes, and prototype
pollution keys. SVG data is sanitized before it can be rendered. Imported
unknown fields are discarded by the validator.

The exported project intentionally contains empty `providers`, `connections`,
`skills`, `commands`, and `versions` arrays. Editable Layer/vision prompts,
prompt versions, provider references, chat history, credentials, connection
tools, and private command/skill instructions are not package data. Text in the preview is assigned with
`textContent`; serialized data is escaped before it enters its JSON script
element, and external actions are limited to HTTP(S).

## Preview behavior

`preview/index.html` creates every page and its elements at runtime, provides
page navigation, scales the design coordinate system to the viewport, and
wires the model's navigate, external, scroll, visibility, state, form-submit,
and animation interactions. It is a client-side prototype preview; form and
data actions are not production services.

## Local persistence

Saved projects use IndexedDB (`layer.projects`) with a localStorage recovery
copy and a localStorage fallback when IndexedDB is blocked. The existing
synchronous `loadProject()` remains available during startup; async
`listSavedProjects`, `loadSavedProject`, and `deleteSavedProject` operate on
the multi-project store. Snapshots are bounded to 80 versions by default. If a
project is too large for the synchronous localStorage mirror, the primary
IndexedDB save remains authoritative and a small recovery pointer lets the
application hydrate that project asynchronously on startup.

Screenshot and sampled-frame exports carry project, document-version, page,
selection, label, and capture-time metadata in `screenshots/manifest.json`.
Sampled frames are independent stills with real relative capture timestamps;
they are not presented as a video file.

## Optional dependencies

The host application should install these dependencies:

- `fflate` for ZIP creation and import.
- `html-to-image` for real DOM screenshot capture.
- `tesseract.js` for optional OCR. OCR is loaded dynamically only after the
  user installs/enables it; trained language assets use Tesseract's browser
  cache (`eng`, `fra`, `deu`, `spa`, `ita`, `por`, and `nld` are accepted).

Catalog sources are real network feeds: a same-origin `/api/catalog/fonts`
proxy when available, Google Fonts metadata, the official Fontsource API, and
Iconify's search/SVG/collection endpoints. Results and downloaded font files
are cached in IndexedDB/localStorage with explicit source labels. A catalog
failure is surfaced to the caller and never replaced with fabricated results.
