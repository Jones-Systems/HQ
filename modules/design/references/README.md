# Design references (T8 / HQD-07)

Reference library for websites and native apps: collections, stable IDs,
provenance, rights flags, search and tags, and explicit "use in project" links.
Plan: `spec.hq-design#task.references.001`, tests `spec.hq-design#test.references.001`.

Status: independent first deliverable over labelled fake ports. Not integrated
into the desktop shell, not connected to the real store, and not proof of any
real capture or native runtime.

## Layout

- `src/contract.ts` — section-local types and ports (`ReferenceStoragePort`, `ClockPort`, `IdPort`).
- `src/provenance.ts` — URL/app source normalization, native-evidence and rights validation,
  stable ID derivation and the derived evidence label.
- `src/library.ts` — pure reducers: import, edits, tags, rights, collections, tombstones, project links.
- `src/search.ts` — free-text and structured search (`tag:`, `kind:`, `is:publishable`).
- `src/export.ts` — `hq.design.references-export/v1` with publishable/internal modes.
- `src/persist.ts` — strict `hq.design.references/v1` document validation.
- `src/service.ts` — `ReferenceLibrary`: serialized CAS commits over injected ports.
- `src/envelope.ts` — `ReferenceEnvelope` for a use-in-project link.
- `src/fakes.ts` — `fake:`-labelled ports for tests and previews. Not exported from `src/index.ts`.
- `ui/` — pure view model plus `ReferenceLibraryView` and `ReferenceLibraryPanel`.
- Reference graph (`hq.design.reference-graph/v1`, see below): `src/graph-contract.ts`, `graph-identity.ts`,
  `rights.ts`, `graph-import.ts`, `graph-ops.ts`, `graph-persist.ts`, `graph-flat.ts`, `graph-service.ts`.
- `ui/ReferenceGraphView.tsx`, `ReferenceGraphPanel.tsx`, `graph-view-model.ts` — graph browser (tree, captures,
  anchors, availability, rights, explicit pin). `harness/` is a section-local Vite review harness over fakes.
- Reference packets and bundles (`hq.design.reference-packet/v1`, see below): `src/packet.ts` plus
  `ReferenceGraph.exportPacket` / `adoptPacket`.

## Invariants

- **Stable ID.** `ref_` + SHA-256 of the JCS identity `{v, source, kind, asset digest}`.
  The source is a normalized URL (lowercase scheme/host, no default port or fragment;
  credentials rejected) or `{platform, appId, screen}`. Titles, notes, capture time and
  app display names never participate. Re-importing the same identity keeps the ID and
  never overwrites title, notes, tags, rights or capture provenance; an identical
  repeat writes nothing. A tombstoned match stays tombstoned until explicitly restored.
- **Evidence.** `kind` is capture provenance. The execution label is derived, never
  supplied. Only `native` references with an app source and validated native evidence
  are native execution. A screenshot, recording or web prototype that claims native
  evidence is rejected at import and at document load.
- **Rights.** Missing rights are `unknown`. `permitted` needs a stated basis. A
  `publishable` export contains only permitted, live references and their blobs, omits
  notes and project links, and lists every exclusion. Importer rights are recorded as
  `agent-reported` unless the capture is `owner-judged`; `setRights` records `owner-judged`.
- **Deletion.** Deleting a collection or reference sets `tombstonedAt`. Membership is kept
  for restore. The storage port has no blob deletion.
- **Use in project.** A link is data only. Repeating the same link returns the existing
  one; it never sends, launches or navigates.
- **Persistence.** One workspace document (`design/references/library`) committed with
  compare-and-swap. A conflict is a known no-effect and is reapplied once on reloaded
  state. A thrown write is an unknown effect: the library fences writes until `reload()`
  reads authoritative state. A newer schema or an invalid document opens read-only and is
  never repaired or written.

## Reference graph (`hq.design.reference-graph/v1`)

Plan: `spec.hq-expansion#task.reference-graph.001`, tests `spec.hq-expansion#test.reference-graph.001`.
A separate workspace document (`design/references/graph`) beside the flat library, which is read and never
rewritten (`hq.design.references/v1` keeps its schema, keys, IDs and strict closed shape). Graph state and
capture blobs live only in the workspace storage port; `GraphPorts` has no cache port.

- **Subjects.** `site > page` for websites and `app > flow | screen` for native apps. A subject ID is
  `sub_` + SHA-256 of the JCS identity (`{kind, origin|url|platform+appId|app+key}`); titles never take part.
  A flow's `steps` are ordered screen subjects; a repeat import appends new steps and never reorders.
- **Captures.** `cap_` + SHA-256 of `{subject, kind, asset digest, captureKey}`. A capture is an immutable
  reference to an exact asset digest (`captureKey` stands in for the digest only when there is no asset).
  Re-imports observe it again without overwriting title-like or owner-judged data. A new asset for the same
  subject is a new capture whose `lineage.supersedes` names the previous capture by capture time.
- **Anchors.** `anc_` + SHA-256 of `{capture, asset digest, kind, key}`: sections and elements (fractional
  rectangles) bound to one exact capture digest. A pin to an anchor must name that anchor's own capture.
- **Pins and ratings.** A pin (`pin_` + SHA-256 of project, view, capture, anchor) names one exact
  capture and stores its digest, so a re-capture never moves it. Ratings are an owner-set 1..5 on the
  subject; imports never read or write them.
- **Availability.** Two axes are kept: content (`present`, `no-image`, `blob-missing`) and source (`unchecked`,
  `reachable`, `source-unavailable`, `missing-at-source`). `availabilityLabel` projects them to five distinct
  display states. `refreshAvailability()` re-checks storage; bytes are never invented.
- **Rights.** Producers keep their words (`declared.vocabulary` + `value`); `rights.ts` is the explicit
  mapping table to `permitted | restricted | unknown` (+ `private`). Only a registered pair can map to
  `permitted`, and it still needs a stated basis. Conditional words (`attribution-required`), study-only,
  internal and unknown words never grant; an unregistered vocabulary or value is `unknown`. A document whose
  stored `effective` disagrees with the registry is invalid. A re-import can only tighten an
  agent-reported grant, never loosen anything and never touch an owner judgement.
- **Provenance.** `provenance.producer` is an optional identity string (for example a pipeline name), never a
  dependency; `origin` is `import`, `flat-library` or `packet`; `capturedBy` keeps its claim level.
- **Inert content.** Capture assets are limited to `INERT_MEDIA_TYPES` (raster images and video). HTML, SVG,
  scripts and archives are rejected at import and at load; nothing is fetched.
- **Flat library.** `adoptFlatLibrary(library.state)` maps v1 references into the graph (URL > site/page,
  app > screen) keyed back by `referenceId`; unsupported media and tombstoned references are listed as skipped.
- **Persistence.** Same discipline as the library: serialized CAS commits, a thrown write fences until
  `reload()`, a newer schema or an invalid document opens read-only and is never repaired or written. Every
  ID is re-derived on load.

## Reference packets (`hq.design.reference-packet/v1`)

Plan: `spec.hq-expansion#task.reference-packets.001`, tests `spec.hq-expansion#test.reference-packets.001`.
A packet is an immutable manifest of graph subjects, captures, anchors and the blobs they need, by digest. It
carries no bytes, URLs to fetch, markup or timestamps, so one selection has one packet and one digest.

- **Closed shape.** `parsePacket` accepts only the documented fields at every level, ascending unique IDs, an
  exact `blobs` list for the captures' assets, the fixed `omitted` list, inert media types only, and rights
  that agree with the registry. It re-derives every subject, capture and anchor ID and the `packetDigest`
  (`sha256:` + SHA-256 of the JCS form of every other field). Anything else is `invalid` with a path;
  a newer `hq.design.reference-packet/vN` is `future-schema`. Nothing is repaired or written.
- **Export.** `exportPacket({ mode, captureIds? | projectId? })` returns `{ packet, bundle }`. `internal`
  includes every live selected capture; `publishable` includes only live captures that are explicit,
  non-private grants with servable bytes, and lists every other selected capture under `excluded` with
  `rights-restricted`, `rights-unknown`, `private`, `tombstoned` or `blob-missing`. Ratings, pins, local
  reference links, content availability and tombstoned records are never exported (listed in `omitted`). The
  packet validates itself before it is returned.
- **Adoption.** `adoptPacket(input, { blobs? })` validates first, then applies through the same idempotent
  core as tree imports: the same packet twice writes nothing. Supplied blob bytes are verified against the
  packet's digests before any write; absent bytes leave the capture `blob-missing` and are reported, never
  invented. Adoption never promotes rights (a packet grant over local `unknown` stays `unknown`), may tighten
  an agent-reported local grant, never touches an owner judgement, and records an adopted claim as
  `agent-reported`. Local pins, ratings and lineage are untouched.
- **ReferenceBundle** (`hq.design.reference-bundle/v1`). `{ packetDigest, mode, captureIds, rights, excluded }`
  with a `RightsSummary` (`total`, `permitted`, `restricted`, `unknown`, `private`, `agentReportedGrants`,
  `publishable`). Root maps it to existing request evidence; `bundleMatchesPacket` checks it is exactly the
  projection of a packet. A bundle names captures and counts; it carries no content.

## Review harness

`node_modules/.bin/vite --config modules/design/references/harness/vite.config.ts` serves the graph browser
on `127.0.0.1:5191` with synthetic sites, apps and labelled fake storage. It copies the shell's theme tokens
and is not the desktop shell, Electron or a real store.

## Checks

From the HQ root, with one serial process under the shared check lock:

```sh
node --test --test-concurrency=1 modules/design/references/test/*.test.ts
node_modules/.bin/tsc -p modules/design/references/tsconfig.json
npx vitest run --config modules/design/references/vitest.config.ts
```

The rendered checks use `react-dom/server` markup. They prove rendered structure and
labels, not browser layout, interaction or Electron capture.

## Integration notes

- HQD-12 imports pass `ReferenceImportCandidate`s to `ReferenceLibrary.importReference` /
  `importMany`. Imported examples arrive at their own claim level and never become
  owner judgments.
- Root opens `ReferenceLibrary.open({ storage, clock, ids })` with the store's workspace
  namespace and mounts `ReferenceLibraryPanel` with `currentProject` and a sandboxed
  `previewUrl`. The section's JCS/SHA-256 helper is local until T1 promotes one shared
  implementation.
