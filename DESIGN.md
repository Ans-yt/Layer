# Layer design system

<!-- impeccable:design-schema 1 -->

Layer is an **Operate** surface: the canvas and document state lead; chrome stays quiet and task-oriented.

## Visual world

The editor uses a black-glass jackfield grammar. Graphite surfaces hold the work, amber marks actions and active states, blue dotted guides describe relationships, and green means a local connection or saved state. The UI is deliberately compact without hiding precise controls.

## Tokens

- Ink: `#0b0c0e`; secondary ink: `#0f1115`.
- Panel: `#12151a`; raised panel: `#171b22`; border: `#2b323e`.
- Text: `#f4f1e8`; muted text: `#8993a4`; quiet text: `#5d6675`.
- Signal amber: `#f5b847`; bright amber: `#ffd278`.
- Guide blue: `#8dccff`; success green: `#85d3a0`; warning red: `#e78e87`.
- Radius: 6–10px for UI controls; artboard objects preserve their own corner values.
- Mono face is reserved for measurements, IDs, save state, and technical labels.

## Composition

The app shell is a four-zone workspace: a 48px tool rail, a 234px pages/layers rail, a flexible canvas, and a 322px inspector. Below 1200px, the inspector narrows; below 900px it becomes an overlay; below 650px pages collapse and the tool rail remains reachable.

## Interaction language

- Amber fill marks the primary action; it is not used as decorative decoration.
- Blue dotted guides are spatial evidence, not selection decoration.
- Right-click context menus preserve a multi-selection; `Ask Layer` is always available at object scope.
- Preview is explicitly labeled and runs prototype definitions, not production services.
- AI changes enter through a proposal with an explicit apply/cancel decision unless the user enables automatic apply.

## Type and accessibility

The surface uses Aptos/Segoe UI as a workhorse UI stack with comfortable 10–18px controls and a 23–54px document hierarchy. Focus rings use amber; interactive controls preserve 40px or larger hit areas where layout allows. Reduced motion is honored in CSS and prototype playback. Review checks cover contrast, overflow, alt text, and interactive target size.

## Provenance

The world was derived from the assigned operate-b-normalled-jackfield direction, seed `ad256a3f`. The built canvas, inspector, connection panels, and export preview are the source of truth for this document.
