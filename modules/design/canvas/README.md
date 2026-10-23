# Design canvas (HQD-02)

Section T3 of `spec.hq-design` (`#task.canvas.001`, `#test.canvas.001`). It provides an infinite canvas with pan and zoom (wheel, trackpad, keyboard), artboards, selection and multi-select, arranging, snapping, and an inspector. Items come from registered `CanvasItemProvider`s.

The section has three parts:

- **Framework-free model** (`src/index.ts`). It covers camera geometry, the arrangement record and its operations, snapping, history, input normalization, the provider registry, the inspector model, the strict codec and persistence, and the pure `reduceCanvas` controller. Node 24 runs it directly.
- **React view** (`src/view/index.ts` and `src/view/canvas.css`). `CanvasWorkspace` combines a toolbar, `CanvasView`, the `Inspector` and save status. `useCanvasDocument` loads the arrangement and autosaves it.
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

## Composition ports (root wiring)

`CanvasWorkspace` takes these props:

- `projectId` and `canvasId`
- `storage: CanvasStoragePort`, an adapter over the durable store's `workspace` namespace
- `registry: ProviderRegistry`, with providers from components (HQD-09), flows (HQD-10) and an adapter over project views/versions (HQD-01)
- `ids: IdPort`
- optional per-provider `renderers`
- optional `session` and `onSessionChange` for keep-alive

The section imports nothing from other sections.

## Checks

Run these from the repository root after `npm ci`:

```sh
node --test 'modules/design/canvas/test/*.test.ts'
npx vitest run --config modules/design/canvas/vitest.config.ts
npx tsc -p modules/design/canvas/tsconfig.json
```

The node tests are geometry and reducer checks. The vitest checks are React server-render markup checks. Neither proves rendered layout. Rendered browser-mode geometry needs a real browser (`harness/`). Native Electron capture and installed-runtime behavior are not covered here.
