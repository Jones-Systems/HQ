# References library and composed section

Purpose: browse references with provenance and rights, organize collections,
link a reference to a project, inspect details and explicitly import screenshots.
The real [ReferencesSection](../../modules/design/app/sections/references/View.tsx)
composes [ReferenceLibraryPanel](../../modules/design/references/ui/ReferenceLibraryPanel.tsx),
[ScreenshotImport](../../modules/design/app/sections/references/ScreenshotImport.tsx)
and a [nonempty reference graph](reference-graph.md). An empty graph is hidden;
an empty library presents its welcome/import state.

## Known entry points

- Product navigation: Design → Resources → References (`resources/references`).
  [The composition wrapper](../../modules/design/app/compose/closure-views.tsx)
  mounts the section over its workspace environment. Restored Design destination
  and the command palette provide additional paths; see the
  [Design chrome](../../modules/design/ui/src/domain.tsx).
- Reference navigation resolves library references to `resources/references` in
  [reference reads](../../modules/design/app/compose/reference-reads.ts).
  This is a destination, not a promise of an opened detail or dispatched work.
- [Integration preview](../../modules/design/preview/README.md), port 5197:
  labelled fake shell → Resources → References. Its descriptor mounts the
  library alone; it does not prove the production section composition.
- Combined section-local harness, port 5191, `/combined.html`: real section,
  real CSS and shared panels over fresh synthetic data. See below.

Product/native navigation and real-store availability are **unverified** by
this map. They require their own qualified desktop/workspace setup. The local
combined fixture does not substitute for those checks.

## Combined synthetic recipe

From the HQ root after dependency setup:

```sh
HQD_PREVIEW_CANDIDATE="$(git rev-parse HEAD)" \
  node_modules/.bin/vite build --config modules/design/references/harness/vite.config.ts
node_modules/.bin/vite preview --config modules/design/references/harness/vite.config.ts
```

For uncommitted source, supply an exact working-candidate label and retain a
file hash manifest; HEAD alone would be misleading. Wait for Vite's loopback
ready message, open `http://127.0.0.1:5191/combined.html`, and require all three:
`References` (three cards), `Reference graph`, and `Import screenshots`.
`window.__referencesHarness.candidate` must match the inspected source.
Verify loaded module URLs belong to the intended worktree. There is no separate
harness doctor command. An occupied port fails under `strictPort`; do not kill
its unknown owner.

[The fixture](../../modules/design/references/harness/combined-fixture.ts)
uses the real `createReferencesEnvironment` with fresh labelled fake storage.
It seeds three varied cards (long/short titles, long app source, optional tags
and rights/native status), site/page and app/flow/screen subjects, and two Pricing
captures. Synthetic source URLs are data, not fetch targets. The fixture's blob
reader exercises production validated data-URL previews; `previewReads` on
`window.__referencesHarness` counts reads. The fallback blob URLs, if used,
are owned by this page and revoked on page exit; seed failure also disposes them.
Reload recreates all fixture data and clears selection. Shared panel widths
persist in origin-local preferences; use visible Show/Hide and resize controls,
or an isolated disposable browser context for defaults. Never clear shared
localStorage. Close the owned tab and stop the exact owned Vite process after
retaining evidence. The harness creates no durable reference-store files.

The integration preview's egress scan deliberately excludes all `app/` imports.
This combined page uses the approved section-local fallback so the production
section can be exercised without weakening that guard or registering an
`app/design-module.ts`.

## Journeys and layout anchors

Initial state: Alpha project, three library cards, no selected card or graph
subject. Search filters the library; clear it to restore all three. Select a
card to read full title/source/provenance and close details to return. Use in
project changes only the fixture's in-memory link. Import screenshots opens a
file chooser; use only a task-created synthetic PNG, enter a synthetic URL or
app identity, then explicitly save. Cancel before saving to check the form
without importing. Reload resets fixture mutations.

The real shell owns its outer inset; this harness deliberately uses 24px.
The library owns header, collections, result grid and detail relationships in
[references.css](../../modules/design/references/ui/references.css). Card order
is image → heading/source → badges/caveat/tags → footer. Title space is two lines;
source is ellipsized, with full provenance reachable in details. Footers align
within a grid row through flexible card bodies. Images keep their intrinsic
content colors in either theme. Thumbnails take a `data-presentation`: `banner`
(landscape websites, top-anchored cover), `contained` (portrait or square images and
non-phone app screens, whole on a neutral matte) or `phone` (phone-platform app
screens, whole inside a simple device outline). It derives from source kind,
platform and stored dimensions only; a missing preview keeps its label unframed.

Measure the `.hq-refs` container, not just the viewport: at 599/600px the import
form changes columns, at 759/760px collections/header change arrangement, and
at 1099/1100px selected details switch between above-content and side placement.
In the standalone harness the container is viewport minus 48px. The library's
inner grid is narrower when collections/details are expanded.

## Checks and evidence

Affected commands (serial, with local capacity admission):

```sh
node --test --test-concurrency=1 modules/design/references/test/*.test.ts
node_modules/.bin/tsc -p modules/design/references/tsconfig.json
node_modules/.bin/vitest run --config modules/design/references/vitest.config.ts
node_modules/.bin/tsc -p modules/design/app/sections/tsconfig.json
node_modules/.bin/vitest run --config modules/design/app/sections/vitest.config.ts
node --test --test-concurrency=1 modules/design/preview/test/*.test.ts
npm run typecheck
npm run build
```

The combined rendered check proves that real composition exposes a nonempty
graph beside the library/import controls. Graph rendered checks cover guidance
association/order and selected detail semantics. They do not prove browser geometry.
Browser observations for this candidate are recorded in [graph evidence](reference-graph.md#candidate-evidence).

## Insets/stability candidate evidence

The 2026-10-21 correction uses this real composed section. Deterministic effect
tests reproduce the former image-node removal, then prove retained image identity,
no repeated selection reads, deduplicated pending reads and stale provider/deletion
handling. Browser checks at container widths 1099, 1100 and 1440 in both themes
use three seeded cards plus one explicitly imported synthetic image: zero card
rectangle movement, zero removed thumbnails and zero extra preview reads when
switching between already-open details. First open may reposition content.
The narrow details body scrolls at 40vh; full provenance remains reachable.
At 760px viewport and 200% text, the checked details endpoint remains reachable
without horizontal overflow. Other extreme text-spacing/native journeys are not
inferred. Exact source/build hashes and captures stay in the task's private
evidence; the evolving Work Note records publication and check status.
