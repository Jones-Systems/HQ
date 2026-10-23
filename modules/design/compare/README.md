# HQD-03 compare

Side-by-side comparison of N exact versions or views (`spec.hq-design#task.compare.001`). Lane T4 owns this directory only.

## What it does

- **Independent panel widths.** `resizePanel` changes one panel. The other panels stay as the identical objects. Nothing is redistributed, and the strip scrolls horizontally when the panels are wider than the screen. Each panel has a keyboard-operable `separator` (Arrow keys ±16 px, Shift ±64 px) and a pointer drag handle.
- **Synced scroll by ratio.** With sync on, each other panel moves to the same fraction of its own scroll range (`mapScroll`), so a short page and a long page reach their ends together. Turning sync off unlinks the panels without moving anything. Turning it on aligns the others to a leader once (the baseline, or the first panel if there is no baseline). A panel whose content size is still unknown is left where it is rather than guessed.
- **Device/viewport presets** (`VIEWPORT_PRESETS`: generic phone, tablet, laptop and desktop sizes in CSS px with DPR). A live preview takes any preset. A static capture keeps the viewport it was captured at; choosing a preset selects another capture of the same version at that viewport, or reports `no-capture-at-viewport`. "Match viewports" applies the leader's viewport to live panels and reports static panels as skipped.
- **Exact version binding.** A `PanelSource` always holds a `VersionId`, plus `captureId` and `captureDigest` for a static capture. There is no "latest" source kind and no catalog accessor for it. `parseVersionId` rejects moving aliases (`latest`, `head`, `current`, `newest`, `tip`). Selection goes through `VersionCatalogPort.getVersion(exactId)`. Adding a newer version never changes a pinned panel.
- **Distinct source labels.** `Static capture` and `Live preview` badges never share an evidence class. A browser capture says it is not native evidence, and a simulator capture says it is not device evidence. Synthetic fixtures and labelled-fake previews are always marked. A missing or digest-mismatched capture fails visibly with nothing substituted. A live panel with no preview capability shows as unavailable, never as a capture stand-in.
- **Baseline/candidate identity.** A comparison has at most one baseline; choosing a new one demotes the old one to reference. `createBaselineCandidate` builds the before/after pair that the requests review screen needs.
- **Layout persistence** `hq.design.comparison/v1` (`persist.ts`). The parser is strict and serialization is deterministic. A future schema is reported as `unsupported-version` and never opened, written, repaired or migrated. Saving happens only on an explicit `save()` through the injected `CompareStoragePort`.

## Ports (`src/contract.ts`)

| Port | Purpose | Real owner |
| --- | --- | --- |
| `VersionCatalogPort` | exact `getVersion`, `listVersions(viewId)`, `listViews(projectId)` | HQD-01 / root project registry |
| `PreviewCapability` | `open(request, signal) → PreviewSession` with `qualification` | root S2 (qualified surface) |
| `CaptureImagePort` | digest-verified capture bytes → `src` | store / root |
| `CompareStoragePort` | workspace-namespace layout documents | HQD-08 store |
| `OverlayFrame` + `renderOverlay` slot | source-CSS-pixel frame for annotation overlays | HQD-04 |
| `renderHostSurface` slot | renders a root-owned `host-surface` preview session | root S2 |

The shell CSP has `frame-src 'none'`, so compare **never creates an iframe**. The fake preview returns a `synthetic` surface drawn as DOM blocks. A qualified preview is a `host-surface` that root renders through the slot. A live session is shown as qualified only if both the capability and the session say `qualified`. A session that reports a different `VersionId` is closed and rejected. Results for a source or viewport that is no longer current are discarded and their sessions closed.

`src/fakes.ts` holds the **labelled fakes** (catalog, preview, capture images, storage) and a synthetic two-view sample project. Fixture digests are deterministic placeholders, not hashes of real bytes.

## Entry points

- `src/index.ts`: React-free models, ports, controller (`createCompareController`, `loadComparison`).
- `src/view/index.tsx`: `CompareWorkspace` (also imports `compare.css`). Chrome uses the shell tokens (`--surface`, `--line`, `--accent`…); captured and previewed content keeps its own colors.
- `demo/`: a local review harness with labelled fakes. Nothing imports it; it can be deleted without affecting the section.

## Checks (`design-compare` group)

Run from the repository root after `npm ci`:

```sh
npx vitest run --config modules/design/compare/vitest.config.ts
npx tsc -p modules/design/compare/tsconfig.json
npx vite --config modules/design/compare/demo/vite.config.ts   # local demo at http://127.0.0.1:5183
```

The root `npm test` does not include this section yet. Tests use the root's vitest so they can join the root include later unchanged.

Evidence classes: the model, controller and persistence tests are behavioral unit checks. `view.test.ts` uses `react-dom/server` and proves the rendered markup and attributes only. Browser layout, scrolling and drag need a real browser run of the demo. Real preview, real capture bytes, Electron behavior and native evidence remain unverified until root S2 integration.
