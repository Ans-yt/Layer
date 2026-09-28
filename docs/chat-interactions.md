# Chat and parameter interactions

## Navigation

- The chat header's parameters button opens Connections in the same sidebar.
- **Back to chat** remains visible at the top of Connections while scrolling.
- Returning restores focus to the parameters button when it opened the settings.
- Chat remains mounted but hidden while another panel is active. The draft,
  prompt disclosure, messages and reading position survive panel navigation.
  Drafts are session-only: they are not written into project exports or storage.
- Sending is blocked while a request is running without clearing the next draft.
- Streaming follows the latest reply only when the reader is already near the
  bottom. Otherwise **Latest message** returns to the end explicitly.

## Hints and interaction states

- `TooltipLayer` renders one plain-text hint in a body portal, outside clipping
  panels. Use `data-tooltip`, optional `data-tooltip-side` and
  `data-tooltip-shortcut` on the control; retain its accessible name.
- Hints appear after 350ms of mouse hover or immediately on keyboard focus.
  Escape dismisses the hint without clearing the canvas selection. Clicking,
  scrolling, changing panels, and losing window focus dismiss it too.
- Tooltip placement flips and clamps at viewport edges. Hints stay visible
  when the pointer travels onto them and preserve existing ARIA descriptions.
- Tooltips never change the anchor's positioning or reuse its pseudo-elements.
- Chat controls use brief color/border transitions and small press feedback.
  Reading text does not move on hover. Reduced-motion preferences are honored.
- Provider controls reflow into a single-column detail view in narrow sidebars.

## Verification

```sh
npm run build
npm test
npm run test:e2e
npm run test:chat
```

The chat browser check uses isolated Chromium contexts at 1440, 1024 and 540px.
Provider/connection reads use empty fixtures; no keys or live AI calls are
needed. Captures are written to `screenshots/chat-polish/`.
Unit coverage includes draft retention, focus return, busy-state draft safety,
stream-follow behavior and mouse/keyboard tooltip lifecycle and positioning.

The design detector's grid advisory applies to the existing measurement canvas,
not chat decoration. The resize indicator uses a transform rather than a height
transition. These checks do not assert live-provider or whole-editor correctness.
