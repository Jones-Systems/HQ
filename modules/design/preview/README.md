# Design integration preview (HQD-INT-ASSEMBLE)

A first look at the fourteen assembled Design cones. T14's real Design chrome
(`createDesignDomain`) runs inside a **labelled fake HQ shell**, and each
section's real UI entry point is mounted over that section's own labelled fakes
and synthetic seeds. It is review tooling: not the HQ app, not Electron, not
production wiring, and removable as one directory.

## What it shows

| Area | Sections (preview-local descriptors under `sections/<id>/`) |
| --- | --- |
| Projects | Projects (T2), Discovery (T15) |
| Resources | References (T8), Components (T10), Flows (T11) |
| Review | Canvas (T3), Compare (T4), Annotations (T5), Taste (T7) |
| Requests | Requests (T6), Imports (T13) |
| Runs | Connector (T12) |

This is T14's suggested placement, put up for product review. The store
(`packages/design-store`, T9) is headless. It is assembled and checked but not
mounted, because it is a Node filesystem store with no UI.

The fake shell has domain switching (Design unmounts on switch), Light/Dark,
two synthetic projects, a request summary and an assembly list. Chrome state
persists in one `localStorage` key per project, `hq.design.ui-session.v1:<projectId>`.
Section seeds live for the page's lifetime, so a domain switch remounts the real
views over the same in-memory state.

## Holds and limits

- **No capability registered.** There is no transport (the connector's registry
  is empty, so every destination is "Not qualified"), no dispatch slot for
  requests, no discovery source adapter and no refresh-on-open, no preload
  bridge, no credentials and no durable store.
- **Component scripts are held.** Sandbox frames are `srcdoc` documents and
  inherit this page's shell-mirroring CSP (`script-src 'self'`). Bootstrap and
  component scripts are blocked, as they are in the shell today, until the
  sandbox direction is decided.
- **The page CSP is the shell's** (`apps/desktop/index.html`), plus Vite's
  inline styles and loopback HMR socket, plus `blob:` images, which discovery's
  cached thumbnails use. The shell itself has no `blob:` allowance, so that
  difference is an integration item.
- Compare previews and captures are synthetic, and annotations run in
  static-capture mode with Pick/Cite unavailable. Taste uses the lane's
  in-memory review client seeded for one synthetic project.
- **What the evidence covers.** Browser evidence proves this harness only. A
  request log, CSP reports and the static scan support the observed session;
  they are not a network-isolation claim.

## Run

From the HQ root after `npm ci`. Take a capacity sample and hold the shared
check lock for the checks and the build.

```sh
# Loopback dev server on http://127.0.0.1:5197/ with a JSONL log of every request it receives
HQD_PREVIEW_CANDIDATE=$(git rev-parse HEAD) HQD_PREVIEW_REQUEST_LOG=/tmp/hqd-preview-requests.jsonl \
  npx vite --config modules/design/preview/vite.config.ts

# Production build of the preview (output in node_modules/.cache/hq-design-preview/dist)
npx vite build --config modules/design/preview/vite.config.ts

# Every cone's typecheck, node:test and vitest command, plus this preview's, serially
modules/design/preview/section-checks.sh
```

`test/registry.test.ts` checks that every section cone has exactly one preview
descriptor and that T14's registry accepts them all. `test/egress-scan.test.ts`
walks the preview's import graph from `main.tsx` and checks four things:
- no network, bridge or Node API appears in it;
- the isolation probe, Node adapters, preview agent and store stay out of it;
- every remote URL literal in it is allowlisted inert data;
- no transport or source adapter is wired.

In the page, `window.__hqdPreview` exposes the fake shell, the domain, the
registry and the egress observer for runtime evidence.
