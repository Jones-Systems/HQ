# Wiki module assembly: evidence and hand-off

Task `task.wiki-assembly.001` (lane T6) of `docs/engineering-specs/hq-integration-parallel-execution.md`, plan commit
`f2a81c4f1a0ab14c89cec5764b42891059630f5e`. Test Intent `test.wiki-assembly.001`, check group `hq-wiki-module`.
All data below is **synthetic**: no private corpus, personal data, host address or credential was read or written.

Completion is not acceptance. T1 decides acceptance and lands the PR; T2 mounts the module; T7 qualifies the app.

## What was assembled

`modules/wiki/app/` (design and behaviour: [`modules/wiki/app/README.md`](../../../modules/wiki/app/README.md)) on top of the
unchanged, already merged contract, core and UI:

- a domain descriptor and `Component` (`createWikiDomain({ getPort })`, `presentation: 'fill'`);
- a renderer client, `createWikiClient(getPort)`, over the seven-method host port of `iface.wiki-host-ipc.001`;
- the stylesheets as files (`wiki-view.css` reused, `wiki-domain.css` added), imported only by the production entry;
- `modules/wiki/package.json` (`@hq/wiki`, private, `react` only, `engines.node >=22.18.0`) and `modules/wiki/tsconfig.json`;
- a synthetic Wiki corpus (`app/fixtures/corpus`) that the tests commit into bare Git repositories, and `node:test` suites.

Nothing outside `modules/wiki/**` and `docs/evidence/hq-wiki/**` changed. `iface.service-response.001` and
`iface.wiki-host-ipc.001` are consumed as written; neither was altered.

## Evidence

Run serially from the repository root on Node v24.19.0 after a fresh admission reading (CPU 16.72% used, 39.81 GiB RAM
available, one fully used core = 6.25% of capacity; one serial process started).

| Check | Result |
| --- | --- |
| `node --test modules/wiki/{contract,core,ui,app}/test/*.test.ts` | 504 tests, 504 pass, 0 fail, 0 skipped (392 existing + 112 new in `app/test`) |
| `tsc -p modules/wiki/tsconfig.json --noEmit` (assembly + contract/core/ui through imports) | exit 0 |
| `tsc -p modules/wiki/{contract,core,ui}/tsconfig.json --noEmit` | exit 0 each |
| Module entry under the **root** compiler options (temporary probe config, removed) | exit 0 |
| Root `tsc --noEmit` and `vitest run` | exit 0; 47 files, 749 tests pass (unchanged: Wiki is not in root discovery) |
| Mutation sanity check on the client (dropped the key-consistency check and the request guard) | 20 of 51 client tests failed; restored, 51 pass |

The Test Intent predicate maps to: contract, core, UI and assembly tests pass (above); CSS is an external file
(`csp-build.test.ts` builds the production entry with the repository's Vite and finds one emitted `.css` file, no style
injection, no inline-style code; `static.test.ts` bans inline styles in source); no private corpus is read
(committed-fixture-only reads, `static.test.ts` public-safety scans, scratch under a unique home directory). The invalid
conditions are covered: no inline style needing a CSP change; no arbitrary path access (the request guard answers
`path`/`root`/`url`/`argv`/`cwd`/traversal requests locally and the port is never called). The unknown condition does not
apply: Node >=22.18 was available (v24.19.0).

**Not shown:** the mounted shell, Electron, the real preload/IPC channel (`structuredClone` stands in), hosted CI on this
PR (see the PR for exact-head results), and the installed app.

## Hand-off to T2 (root, mounting, bridge)

1. **Mount.** `createWikiDomain({ getPort })` from `modules/wiki/app/src/index.ts` (or `@hq/wiki` once registered). Supply the
   preload bridge, or `null`. Use `domain.label` and `domain.presentation` (`'fill'`). The view needs no padding from the shell.
2. **Bridge shape.** Expose exactly `listSources`, `search`, `getPage`, `resolveAlias`, `getBacklinks`, `listTopics`,
   `indexStatus`, each taking the contract request object (none for the two argument-free methods) and resolving a
   `WikiResult`. Keep `refresh` and home migration in main over `modules/wiki/core`. The contract does not name the
   global or channels, so the module takes `getPort`; the names are T2's.
3. **Types.** `WikiModulePort` in `app/src/port.ts` is structurally `ModulePort`; T2 proves assignability to the canonical type.
   `DOMAIN_IDS` in `@hq/contracts` has no `wiki` yet: the descriptor's `id: 'wiki'` is the intended id for the fourth rail slot.
4. **Workspace and lock.** Add `modules/wiki` to the root `workspaces` (the package declares `react: 19.3.1`, the locked
   version) and regenerate the lock. Root typecheck can include `modules/wiki/app/src` (verified under the root options).
5. **Vitest isolation.** Do **not** add `modules/wiki` to `roots` in `vitest.config.ts`: its `**/*.test.ts` glob would pick up
   the `node:test` suites and fail with "no test suite". Keep them under a `node --test` script (`@hq/wiki`'s `test` script
   runs all four Wiki directories). The `hq-wiki-module` check group command is that script.
6. **Node.** The Wiki suites need Node >=22.18 for native TypeScript type stripping; root `engines` still says `>=22.12.0`.
   Raise the root engine or scope the requirement to the Wiki check in the `tests/check-groups.toml` amendment.
7. **CSS.** Nothing to do for the CSP: Vite emits the two stylesheets as a file. The renderer entry must keep importing
   `index.ts` (which carries the imports) rather than `domain.ts`.
8. **Destinations.** Existing shell destinations must migrate so `home` maps to the Wiki home. The shell's 512-character
   destination cap remains the accepted UI **P2** below.

## Findings (recorded, not implemented)

Original UI findings still apply to the mounted shell (copied from `modules/wiki/ui/README.md`, original severity):
**P2** destinations longer than 512 characters cannot persist through the shell; **P3** omitted null frontmatter fields lose
key presence; **P3** `checkTopicList` allows long parent cycles (the UI guards); **P3** disambiguation and the repository
filter have no destination form; **P4** topic previews and alias candidates carry keys only.

New, found while assembling:

- **P3** (seam) `iface.wiki-host-ipc.001` names no preload global or channel, so the module cannot discover the bridge
  itself; `getPort` injection is a working assumption T2 must confirm when it builds the bridge.
- **P3** (root) the root `engines.node` (`>=22.12.0`) is lower than the Wiki check's `>=22.18`; the check group needs its
  own Node requirement or a root engine raise.
- **P3** (root) the existing hosted workflows (`foundation.yml`, `design-sections.yml`) do not run the Wiki `node:test`
  suites, so a green hosted check on this PR does not evidence them; the local results above do. Wiring the
  `hq-wiki-module` group into CI belongs to the `tests/check-groups.toml` / workflow amendment, which is outside this lane's scope.
- **P4** `mounted.test.ts` imports the UI lane's test helpers (`ui/test/dom.ts`, `ui/test/render.ts`); a change to them
  affects this suite. Accepted as read-only reuse over duplicating a DOM harness.
- **P4** the client does not time out a port call; a bridge that never settles leaves the view in its loading state
  (the view's own sequence guard still discards stale answers).
- **P4** the bundle size of the Wiki entry is unmeasured.

## Wiki pages as cross-module reference targets (task B5-W2)

Base `work/hq-foundation` at `0cd50abc974320771cc21145dc8a8fd58a3eb8b1`. Before this, `REFERENCE_PROVIDERS` had Design,
Social and Work but no Wiki provider, so "Link to…" in Work and Social could not attach a Wiki page, a stored reference to
one never resolved, and the shell's `ReferencePort.find` (the palette lane, F7 finding X9 on PR #185) could not find one.

What changed (design and rules: [`modules/wiki/app/README.md`](../../../modules/wiki/app/README.md)):

- `modules/wiki/app/src/references.ts`: `createWikiReferenceProvider(service, now)`; `domain: 'wiki'`, `kinds: ['page']`,
  `entityId` = `<namespace>/<path>`. It calls only `search` and `getPage`, stores no outgoing HQ links (RL-1) and has no
  execution member (RL-10). The Wiki is a reference **target** only.
- `apps/desktop/src/reference-providers.ts` registers it with a Wiki client built like the mounted module's, so a missing
  bridge finds nothing and resolves `unavailable`.
- Revision: `sourceRevision` is `wiki-c1:` + SHA-256 of the canonical JSON of `{ byteLength, title, fields, content }`. The
  commit id is excluded on purpose, so an unrelated later commit leaves a link `available`; only a change to the page's own
  content makes it `changed`.
- Caps are `parseReference`'s: a page whose id exceeds 160 characters (or whose destination exceeds 512) is omitted from
  `find`, and titles are cut at 300 without splitting a surrogate pair.
- One existing assertion changed outside the lane's file list: `references.integration.test.tsx` pinned the registry as
  `['design', 'social', 'work']`; it now pins `['design', 'social', 'work', 'wiki']`. Nothing was loosened.

Evidence, run serially from the repository root on Node v24.19.0, each after its own CPU admission sample (57.6%, 75.4%,
83.18%, 77.74%, 57.99% used, in the order listed):

| Check | Result |
| --- | --- |
| `node --test modules/wiki/app/test/*.test.ts` | 140 tests, 140 pass, 0 fail, 0 skipped (29 new in `references.test.ts`) |
| `node --test modules/wiki/{contract,core,ui}/test/*.test.ts` | 395 tests, 395 pass, 0 fail, 0 skipped |
| `tsc -p modules/wiki/tsconfig.json --noEmit` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (build, then root Vitest) | 118 files, 1876 tests pass, 0 fail, 0 skipped (3 new in `wiki-references.integration.test.tsx`) |
| Mutation sanity check on the provider (dropped the surrogate guard; put the commit id into the revision) | 3 of 29 `references.test.ts` tests failed; restored, 29 pass. This short run was sampled at 93.55% CPU, above the 85% admission limit |

What the tests show: over the real core and committed synthetic repositories, `find` returns valid envelopes from both
namespaces that resolve `available`, a path with spaces, non-ASCII letters and `&` round-trips through its destination, a
later commit that leaves a page untouched stays `available`, and only `search` and `getPage` cross the bridge. Over scripted
services: limits, the kinds filter, the empty query, the 160/300/512 caps, every status, invalid ids (`../x`, absolute, other
namespace, wrong kind or domain), `observedAt` taken after the read, and a service Proxy that fails on any other member. In the
real `App` over the real Wiki runtime: a Work card with `hq-references-v1` shows a stale Wiki link as Changed and a removed page
as Missing (not openable, snapshot kept), "Link to…" finds and saves a Wiki page through the Planner, opening it shows the page,
and Back restores the card with its unsaved text; the shell's `ReferencePort` finds, resolves and opens Wiki pages directly; zero
execution calls on the Social recorder and the Work route list.

**Not shown:** the packaged Electron app and the real preload/IPC channel (the host boundary is the same seven-method handler
the shell uses, called in-process), hosted CI at the exact head, and Social's "Link to…" flow against a Wiki page (Social's
picker uses the same `LinkPicker` and `ReferencePort`; only Work's is driven end to end).

Findings, original severity:

- **P3** `find` costs one `search` plus one `getPage` per hit (at most the scope limit, 50 at most) to give each envelope a
  content revision; the host bridge serialises them, so picker latency grows with the number of hits. A cheaper design would
  need the search result to carry a content digest, which is a Wiki contract change.
- **P3** `references.ts` restates `parseReference`'s caps because the Wiki package may not import `@hq/contracts`
  (`static.test.ts`, `react` as the only dependency). `references.test.ts` pins the restatement; a change to the shared caps
  would need the same change here.
- **P4** a page whose id fits in 160 characters but whose encoded destination exceeds 512 (long non-ASCII paths) cannot be
  referenced at all; this is the same 512-character cap recorded as the UI **P2** above.
- **P4** the App's Work module keeps its store for the life of the module, so only one test per file can mount a Work card
  through `App`; `wiki-references.integration.test.tsx` therefore runs one Work journey plus port-level tests.
