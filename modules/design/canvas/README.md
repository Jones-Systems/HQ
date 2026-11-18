# Design canvas (HQD-02)

Section T3 of `spec.hq-design` (`#task.canvas.001`, `#test.canvas.001`). It provides an infinite canvas with pan and zoom (wheel, trackpad, keyboard), artboards, selection and multi-select, arranging, snapping, and an inspector. Items come from registered `CanvasItemProvider`s.

The section has three parts:

- **Framework-free model** (`src/index.ts`). It covers camera geometry, the arrangement record and its operations, snapping, history, input normalization, the provider registry, the inspector model, the strict codec and persistence, and the pure `reduceCanvas` controller. Node 24 runs it directly.
- **React view** (`src/view/index.ts` and `src/view/canvas.css`). `CanvasWorkspace` combines the `Toolbar`, `CanvasView`, the `Inspector` and the save state. `useCanvasDocument` loads the arrangement and autosaves it.
- **Labelled fakes** (`src/fakes.ts`). These are an in-memory storage port, a synthetic provider and sequential IDs, each marked `FAKE`. The model entry does not export them.

`harness/` is a removable review page that runs on the fakes. The product never imports it.

## Invariants

- **Canvas edits write only the arrangement record.** That record is `hq.design.canvas-arrangement/v1` under `workspace` key `design.canvas.arrangement.v1/<canvasId>`. A placement's `ref` (`providerId`, `entityId`, `revision`) is copied when the placement is created and no operation changes it. Providers are read-only from the canvas's side: it calls only `describe`, `list` and `subscribe`.
- **Revisions are pinned exactly.** Nothing is ever bound to "latest". The registry rejects a provider that answers with a different revision. A missing provider or missing revision keeps the placement and shows it as unavailable.
- **Records round-trip through `CanvasStoragePort` unchanged.** Encoding is canonical (sorted keys, ES number form), so the record and its bytes both match after a reload. Decoding is strict and never repairs anything. A future schema, an invalid record, or a record belonging to another canvas opens read-only and is never overwritten. If the stored text no longer matches the editor's base, the save reports a conflict and writes nothing.
- **Undo and redo cover committed arrangement records only.** A drag commits once, when the pointer is released. Camera, selection and focus are per-device session state (`serializeSession` / `restoreSession` for keep-alive) and are not part of history.
- **Zoom is anchored.** `zoomAt` keeps the world point under the cursor fixed, including when zoom is clamped to its limits.

## Input

| Input | Effect |
| --- | --- |
| Wheel or two-finger scroll | Pan (Shift + vertical wheel pans horizontally) |
| Ctrl/⌘ + wheel or trackpad pinch | Zoom around the cursor |
| Space + drag, or middle-button drag | Pan |
| Drag on an empty area | Marquee select (Shift adds) |
| Click, or Shift/Ctrl/⌘-click | Select, or toggle multi-select |
| Drag a selected item | Move with snapping (hold Ctrl/⌘ to disable snapping) |
| Arrows | Nudge the selection by 1 (Shift: 10); pan when nothing is selected |
| Alt/Option + arrows | Always pan |
| `+` / `-`, Ctrl/⌘ + `=` / `-` | Zoom around the viewport center |
| Shift+0 / Shift+1 / Shift+2 | 100% / fit all / fit selection |
| Tab / Shift+Tab | Move focus between nodes in reading order; Tab leaves the canvas after the last node |
| Enter / Space | Select the focused node (Shift toggles) |
| Escape | Cancel a gesture, or clear the selection |
| Delete / Backspace | Remove the selection from the canvas (source items are untouched) |
| Ctrl/⌘ + Z, Shift+Ctrl/⌘ + Z, Ctrl + Y | Undo / redo |
| Ctrl/⌘ + `]` / `[` (Shift: to front/back) | Change layer order |

## Camera, toolbar and frames

- **The camera is three CSS numbers** (`--hq-canvas-x`, `--hq-canvas-y`, `--hq-canvas-zoom`, registered with `@property`) on the canvas root. The world transform, grid, selection frames and artboard names are all derived from them in `canvas.css`, so one animated value moves everything together.
- **Which moves glide.** Zoom in and out, the 100% preset, Fit all and Fit selection (buttons and their keys) ask for an eased move: the reducer counts them in `cameraEase` (memory only, never saved) and `useCameraMotion` plays them over `--hq-duration-slow` with `--hq-ease-standard`, keeping the centre of the view still while zooming about it. Wheel, pinch, pan and drag stay direct, and direct input stops a move in flight and starts from the camera on screen. Reduced motion is instant.
- **Toolbar.** History, Insert and View groups of icon buttons. An action that cannot run keeps its place, does nothing, and says why on hover and keyboard focus (`aria-disabled` with `aria-describedby`).
- **Frames.** Each item is a card: the renderer's body, and a caption strip with the title and a second line (size and provenance by default). Frames too small on screen drop the caption, and tiny ones show no text. Capture pixels are never animated.
- **Feedback.** The save state is a status indicator plus a toast saying what was kept; Retry appears only where repeating is safe.

## Composition ports (root wiring)

`CanvasWorkspace` takes these props:

- `projectId` and `canvasId`
- `storage: CanvasStoragePort`, an adapter over the durable store's `workspace` namespace
- `registry: ProviderRegistry`, with providers from components (HQD-09), flows (HQD-10) and an adapter over project views/versions (HQD-01)
- `ids: IdPort`
- optional per-provider `renderers`: a function returning the body of an item's frame, or `{ body, meta }` to also replace the caption's second line. The frame adds the title caption itself, so a renderer never draws over its own capture
- optional `banner`: a node shown above the canvas for problems with where items come from, so a failing source never replaces what loaded
- optional `session` and `onSessionChange` for keep-alive

The section imports nothing from other sections.

## Checks

Run these from the repository root after `npm ci`:

```sh
node --test 'modules/design/canvas/test/*.test.ts'
npx vitest run --config modules/design/canvas/vitest.config.ts
npx tsc -p modules/design/canvas/tsconfig.json
```

The node tests are geometry, reducer and stylesheet checks. The vitest checks are React server-render markup checks, plus DOM checks (happy-dom) for the toolbar and the camera motion. Neither proves rendered layout or that a browser animates the camera. Rendered browser-mode geometry needs a real browser (`harness/`). Native Electron capture and installed-runtime behavior are not covered here.
