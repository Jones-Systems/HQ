# Design flows (HQD-10, lane T11)

Clickable prototypes for HQ Design: screens, hotspots and transitions, declared routes and states, a flow map, a prototype player and a `CanvasItemProvider`. Task `spec.hq-design#task.flows.001`; test `spec.hq-design#test.flows.001`; writer cone `modules/design/flows/` only.

## Model

`hq.design.flow/v1` (`src/contract.ts`) is a flow document with:

- `routes`: declared routes, each with declared states; the first state is the default.
- `screens`: an exact `versionId` (never "latest"), its `route` and `state`, and a `viewport` in source CSS pixels.
- `hotspots`: a rect on one screen plus one `transition` (`target`, `animation`, `durationMs`). Targets are a screen, a route with an optional state, `back`, or an `external` http(s) URL.

`parseFlow` is strict. It rejects unknown keys, malformed values, duplicate IDs and future schemas, which are reported as `unsupportedSchema` and never down-converted. Broken references are not parse errors, so a flow with a broken target still loads and the target stays visible.

## One edge derivation

`deriveEdges` produces exactly one `FlowEdge` per hotspot with a resolution of `ok`, `back`, `exit` or `broken` (`missing-screen`, `undeclared-route`, `undeclared-state`, `no-screen-for-state`, `ambiguous-route`). Three consumers use that one derivation:

- `validateFlow` reports every broken edge, orphan hotspot, missing start, undeclared state, ambiguous route state, overlap, out-of-bounds hotspot and unreachable screen.
- `layoutFlowMap` draws every edge. Back, exit and broken edges end in labelled stubs, and orphan edges are still listed.
- `createPlayer` activates hotspots through the same edges. A broken target, an exit or back-with-no-history is recorded as a step and leaves the current screen unchanged. The player never opens URLs or touches the network.

Every `PlayerStep.evidence` is a `WebApproximation` whose `nativeEvidence` has the literal type `false`. Its label always says it is a web approximation and not native evidence, including for flows declared as iOS, Android or desktop.

## Ports and fakes

- `FlowStoragePort` is a narrow `workspace` namespace document port. `createFlowRepository` saves only structurally valid documents and never repairs or rewrites what it loads. `createFakeFlowStorage` is an in-memory FAKE and is not durable.
- `ScreenPreviewPort` is where root supplies capture URLs. `FAKE_PREVIEWS` supplies none, so screens render as labelled frames. Captures keep their own colors; HQ appearance styles only the chrome.
- `CanvasItemProvider` (the proposed HQD-02 shape) has `listItems(projectId)` and `resolveItem(key)`. Descriptors carry a stable key `hq.design.flows/<kind>/<flowId>`, `sourceRevision` (the JCS SHA-256 of the exact flow document), `intrinsicSize` and `evidence: 'web-approximation'`. They carry no position because arrangement belongs to the canvas. The provider never writes. Unknown keys resolve to `missing`.
- `jcs.ts` is a section-local RFC 8785 + Web Crypto SHA-256 implementation until root promotes one shared implementation.

## Views

`src/views.ts` provides `FlowMapView`, `PrototypePlayerView`, `FlowsWorkspace` and `FlowCanvasItemView`. They are written with `createElement` so that Node 24 type stripping can render them under `node --test` without a JSX transform. Hotspots are keyboard-focusable buttons. Broken targets appear in an alert, and every step in the log shows its web-approximation label.

`src/presentation.ts` derives display-only screen names from routes (`?screen=today` → `Today`, `…/weddings/` → `Weddings`, `index.html` → `Home`), labels captured states and orders screens: the start screen, then screens its links reach, then saved order. Owner-authored titles are shown as written. Nothing there edits a document or creates a link. The workspace shows a numbered screen list beside the player, with Start, Previous and Next stepping through that list. Previous and Next open screens; they never follow or imply a link. `ScreenPreviewPort.unavailableReason` lets a port explain a missing image.

## Checks

Run the following from this directory:

```sh
node --test test/*.test.ts
```

`test/render.test.ts` needs the root `react` and `react-dom` installed (`npm ci` at the HQ root). It proves React server-rendered markup only. It does not prove browser layout, pointer hit mapping or Electron behavior.

`harness/` is a dev-only browser page that renders `FlowsWorkspace` with the synthetic fixture. Run `npx vite modules/design/flows/harness --host 127.0.0.1` from the HQ root. The harness is not exported from `src/index.ts` and can be deleted without affecting the module.

To typecheck with the root TypeScript 7.0.2, run this from the HQ root:

```sh
npx tsc -p modules/design/flows/tsconfig.json
```

## Not claimed

The following are not claimed:

- Canvas embedding (HQD-02 integration by root).
- Real capture previews.
- Browser click-to-coordinate mapping in a live renderer.
- Durable storage (HQD-08).
- Mounting into the Design module.
- Any native-device evidence.
