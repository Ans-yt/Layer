# Layer implementation checklist

## Checkpoints
- [x] Inspect destination and preserve existing work (new Layer directory).
- [x] React/TypeScript/Vite shell; first production build.
- [x] Shared document operations with validation and reliable history.
- [x] Pixel-accurate dragging, rotation, resizing, snapping, right-mouse workflows.
- [x] Responsive layouts and actual interaction renderer shared with export.
- [x] Project library, recoverable snapshots, asset persistence, safe import.
- [x] Backend with secure credential storage and provider-specific requests.
- [x] Genuine AI request/proposal/apply/cancel/undo workflow and scope validation.
- [x] Real catalog fetching, install/enable/remove, retained asset licenses.
- [x] MCP discovery/calls, skills and slash commands wired into execution.
- [x] Capture/vision, optional OCR and truthful capability handling.
- [x] Runnable export package and round-trip tests.
- [x] Skippable hands-on tutorial and narrow-window navigation.
- [x] Unit tests, server tests, isolated browser workflow tests and repairs.
- [x] Startup instructions, environment documentation and verification matrix.

## Current facts
- Production build passes and generates `public/preview-runtime.js` for exported runnable previews.
- Built-in browser navigation repeatedly timed out in this workspace; isolated Chromium rendered and exercised the local app.
- An unrelated process occupied port 4173 during one pass; the dev server selected 4175. The documented port remains 4173 when free.
- No external AI credentials were supplied. Real adapter fixtures and local failure paths are verified; live provider calls remain unverified.
- The manual editor remains usable without AI or network access; catalog content is labeled unavailable when live services fail.
