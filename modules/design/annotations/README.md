# Design annotations (T5 / HQD-04)

Section-owned annotation model, preview agent and views for HQ Design. Writer
cone: `modules/design/annotations/` only. Governing plan:
`spec.hq-design#task.annotations.001` in `docs/engineering-specs/design.md`.

## What it does

- **Pick element** and **Cite text** are separate tools, agent modes and
  event types. The reducer rejects a text citation while Pick is active and an
  element pick while Cite is active, and persisted records whose kind and
  target disagree fail validation.
- **Ink, box, arrow, label and eraser** create or remove drawn marks. The
  eraser removes drawn marks only; picks and citations are deleted from the
  list.
- **Stable reference letters**: each annotation gets the next letter from a
  monotonic cursor (A…Z, AA…). Deleting B keeps A and C, and the next one is D.
  Letters are never reused, including after undo.
- **Undo/redo** records the before/after content of every edit, so both are
  symmetric for every tool, note edit, deletion and Revisit toggle.
- **Revisit** is a per-annotation toggle, plus a "Show Revisit only" list
  filter. It is undoable and appears in Copy export.
- **Copy export** is plain text with letters, kinds, quotes and notes. It omits
  routes and capture digests, and redacts anything that looks like a local
  filesystem path.

## Coordinate frames

Anchors follow `SourceAnchor` from `iface.contracts.001`. Geometry is stored in
document CSS pixels and the anchor records the capture viewport
(`w`, `h`, `dpr`) and scroll. DPR never changes CSS layout, so an anchor
draws at the same document position at any DPR. `geometry.ts` maps between
source, overlay (scroll and display zoom) and device (DPR) pixels.

When showing annotations, `resolution.ts` reports `exact`, `reflowed`,
`changed`, `frame-mismatch`, `missing` or `other-version`. Picks and citations
are re-found by the live preview agent. Drawn marks at a different layout width
are flagged and kept at their captured coordinates. An anchor is never rebound
to another version.

## Preview agent

`src/preview-agent/` is a pure DOM script with no runtime imports outside its
folder. Root bundles `installPreviewAgent(window, { post })` into the preview
preload and bridges `setMode`, `resolve` and posted events through its typed
adapter (`AgentChannelPort`). The agent reports document CSS pixels and its
live viewport and scroll. Root supplies the version, route, state and capture
digest through `SourceFrame`.

Pick swallows the page's press and click events, so picking never activates
the page. Cite lets clicks through and reports a selection only after it
settles (default 500 ms), so a double or triple click yields one citation.
Quotes are trimmed, and text inside `script`, `style`, `noscript` and
`template` is ignored. When a picked element's structural path misses or now
holds different content, the agent relocates it only if exactly one element
with the same tag has the same text hash. Otherwise it reports the element as
not found.

## Ports and fakes

`contract.ts` defines `IdPort`, `ClipboardPort`, `AnnotationStorePort` and
`AgentChannelPort`. `fakes.ts` provides fakes that report `adapter: 'fake'`.
They are not runtime evidence. A stored document with an unknown schema opens
read-only and is never overwritten.

## Checks

```sh
node --test modules/design/annotations/test/*.test.ts
```

`test/fake-dom.ts` is a labelled fake DOM for agent event routing. Node
geometry tests prove frame arithmetic, not rendered layout. For real-browser
checks, serve the synthetic harness with
`node modules/design/annotations/test/browser/harness.ts` and drive it with a
browser. Electron preload injection and capture geometry are root's S2
integration check.
