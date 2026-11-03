# Backend assessment — Wiki, shared contracts, references, integration and native acceptance (2026-11-03)

Artifact Type: `engineering-spec` (assessment)

Artifact ID: `spec.hq-backend-integration-assessment-20261103`

Purpose: Inventory the Wiki backend against its spec and the owner's real corpora, audit the shared contracts and HQ-reference round trips across Design, Social, Work and Wiki, assess what stops #179 from landing and foundation #2 from leaving draft, and set out what native acceptance this Linux host can verify and what needs the owner's Mac.

Decision owner: M Jones

Consumers: HQ integration owner (T1); lanes B1 (Planner), B2 (Social), B4 (infrastructure), F6 (Wiki and Settings views), F7 (cross-app flows); B5 builders and reviewers

Authority effect: none

Status: early publication. The [B5 workstreams](#5-b5-workstreams) are running; results, PR links and the private-validation aggregates from the new tool are added as they land.

## Summary

- **The Wiki works on real content, but not at usable speed.** All seven `WikiService` methods and Settings' admin `status` answered on both real corpora: BusinessLessons (21,489 pages) and App-Development (522 pages). But a first launch blocked every Wiki call, and every Local Wiki call in Settings, for 173 s. Indexing started one `git` process per page (21,494 in total). Each new source commit adds another 82 MB snapshot that is never deleted. Both defects are P1, and the fix is in progress ([W1](#5-b5-workstreams)). A prototype of its batched reads indexed the same corpus in 13.6 s.
- **Wiki pages cannot be linked from anywhere in HQ.** No Wiki reference provider is registered, so "Link to…" and the cross-HQ palette never find Wiki pages. Even with one, the Planner rejects a Work card that links to a Wiki page: its validator allows only Design, Social and Work. The provider is in progress ([W2](#5-b5-workstreams)). The Planner change is coordinated with lane B1.
- **Wiki private validation has no tool yet.** The spec reserves an owner-run, aggregates-only validation tool, and it has not been built. It is in progress ([W3](#5-b5-workstreams)). The real-content numbers below come from a throwaway lead probe and will be replaced by the tool's output.
- **#179 meets every source requirement, but no native run has happened on it.** It is a clean descendant of foundation (34 ahead, 0 behind), and all six required checks pass on its exact head. The native journeys have never run on it. They are running on this host now ([W5](#5-b5-workstreams)). Merge stays with the integration owner.
- **#2 cannot leave draft.** Its spec acceptance still requires all of the following ([§3.2](#32-what-blocks-foundation-2-from-leaving-draft)):
  - native rows that are gaps or held;
  - seven held capabilities, each behind its own gate;
  - a capability-closure matrix on one exact head;
  - dispositions for the open original PRs (32 open PRs target foundation directly);
  - an owner-bound laptop install route;
  - the owner's merge decision.
- **Native acceptance:** this host can run the build, cleanup, checkpoint and routine journeys under Xvfb and bubblewrap. The Darwin runner, the displayed-image edge of HQ-07, the native chooser and laptop installation need the owner's Mac and owner gates ([§4](#4-native-acceptance)).

## Scope, sources and method

- **Base:** `work/hq-foundation` at `0cd50abc974320771cc21145dc8a8fd58a3eb8b1`, which is the head of #2.
- **Specs:**
  - `hq-expansion.md`: the Wiki sections (`iface.wiki.001` WK-C, WK-CORE, WK-UI and WK-PV), the capsule decisions and the test plan;
  - `hq-social-work.md`: `req.references.001` (RL-1 to RL-11);
  - `hq-integration-parallel-execution.md`: working-app, held-capability, reference-closure, capability-closure, main-delivery and laptop-route sections;
  - `tests/acceptance/README.md`.
- **Pull requests:** #2, #179, #138, #115, #86, #185 (F7), #186 to #188 (B1, B2, B4), and the F6 branch `work/hq-life-wiki-settings-20261103` (no PR yet).
- **Method:**
  - code reading;
  - the repository's synthetic suites;
  - one owner-local run of the production Wiki runtime (`openWikiRuntime` with the real Node Git adapter) against local bare clones of the two corpora, publishing aggregates only.

### Material assumptions

1. **Privacy scope of the real-content run.** This lane's brief asks for the Wiki data layer to work "against real local content". I take that as the owner's direction for an owner-local run under exactly the WK-PV privacy scope:
   - Only aggregate counts, mismatch categories, fallback rates, timing and sizes are published.
   - Content, IDs, names, paths, field names, refs, commits and screenshots stay private.
   - Scratch is task-owned outside `/tmp`, restricted to the owner, and removed when the lane ends.
   - The private source profiles stay outside the repository.

   Whether this run discharges the held "Wiki private validation" gate (`req.held-capabilities.001`) is for the integration owner to decide. This document does not claim it.
2. **Corpus binding.** The runtime reads only bare repositories, and the owner's sources are working checkouts. The run therefore used local bare clones made without network access, at the checkouts' committed refs. One first attempt to fetch into an empty bare repository failed on a missing object and wrote nothing to the source. Both source repositories were verified unchanged.
3. **"History".** The spec defines Wiki history as in-session navigation history, "not a new service method" (`hq-expansion.md`, Wiki UI capsule decision). Revision history and diffs are therefore treated as a new capability that needs an owner decision ([W-9](#w-9-p3-revision-history-is-not-specified)).
4. **Frozen refs.** Original PR refs stay frozen. B5 repairs land as new PRs against `work/hq-foundation`. Nothing is merged, labelled, dispatched, installed or released by this lane.

## 1. Wiki

### 1.1 Inventory: specified, implemented, tested

| Capability | Specified | Implemented | Tested (synthetic) | Real content |
| --- | --- | --- | --- | --- |
| Closed contract `hq.wiki.source/v1`, exactly seven methods | WK-C | `modules/wiki/contract` | Contract validators, fixtures and guard tests | Every response validated |
| Git adapter (fixed argv, bare repository, exact remote, root and ref binding) | WK-CORE, adapter capsule | `node-git-source.ts` | `git-adapter`, `static` | Works; one process per blob ([W-1](#w-1-p1-a-cold-index-blocks-the-wiki-and-settings-for-minutes)) |
| Lexical search (BM25, query ≤256 characters, ≤50 hits, totals and truncation) | WK-C, WK-CORE | core index, `search` | core `index`/`host`; UI `search` | Answers on both corpora; per-query timing comes from W3 |
| Repository filters | Expansion scope; WK-UI | `SearchRequest.namespaces`; UI namespace filter | UI filter tests | Both namespaces |
| Parsed and raw reader (safe AST, inert HTML and unsafe schemes, verbatim raw fallback) | WK-CORE, WK-UI | core `pages`/`frontmatter`, UI reader | core `pages`; UI `reader` | 147 raw of 21,489 (0.68%) and 0 of 522, all correct fallbacks ([W-7](#w-7-p4-source-data-quality-raw-frontmatter)) |
| Aliases and disambiguation | WK-C, WK-CORE, WK-UI | `resolveAlias` with candidates; UI disambiguation | core resolver; UI | 67 ambiguous links in A, 0 in B |
| Backlinks | WK-C, WK-CORE | `getBacklinks` | core `index`; UI reader | Works. Context of each backlink requested by F6 ([W4a](#5-b5-workstreams)) |
| Topics (field or directory mode, cap 500) | WK-CORE | `listTopics` | core; UI `topics` | Works on both corpora; 8,585 pages in A carry topic values |
| History | WK-UI: in-session navigation only | UI history stack | UI history tests | n/a. Revision history is not specified ([W-9](#w-9-p3-revision-history-is-not-specified)) |
| Provenance and freshness (ref, commit, commit time, indexed time, index freshness; remote freshness unknown) | WK-C, WK-UI | `SourceDescriptor`, UI home | UI home | Reports correctly. Content freshness depends on the mirror ([W-5](#w-5-p2-sources-must-be-bare-mirrors-that-nothing-updates)) |
| Root integration: mount, closed preload and IPC, userData cache | Root note after WK-UI | `wiki-host.ts`, `wiki-runtime.mts`, `wiki-admin.ts`, Settings › Local Wiki | `wiki-host.test.ts`, `wiki.integration.test.tsx` | Works; blocking and retention defects ([W-1](#w-1-p1-a-cold-index-blocks-the-wiki-and-settings-for-minutes)–[W-3](#w-3-p2-admin-routes-wait-for-the-whole-rebuild)) |
| Worker indexing | Root note after WK-UI | **Not implemented**: indexing runs in the Electron main process | None | [W-4](#w-4-p2-indexing-runs-in-the-electron-main-process) |
| Private-source validation (WK-PV) | `task.wiki-private-validation.001` | **Not implemented**: `modules/wiki/core/scripts/` is reserved | None | W3 builds the tool |
| Native Wiki journey (`wiki-committed-corpus` row) | `tests/acceptance` reserved rows | **Gap**: no native scenario | None | [§4](#4-native-acceptance) |

The four Wiki Node suites had 506 passing tests at `0cd50ab` (B4's measurement, and the same count in #179's CI).

### 1.2 Real-content results (owner-local; aggregates only)

Corpus A is BusinessLessons and corpus B is App-Development, both at their committed refs. The runtime was the production `openWikiRuntime` in a Node 24 process with the real adapter.

| Measure | A | B |
| --- | --- | --- |
| Pages indexed | 21,489 | 522 |
| Entries skipped (symlink, submodule, invalid path, oversize) | 0 | 0 |
| Raw pages (frontmatter / Markdown / not text) | 147 / 0 / 0 | 0 / 0 / 0 |
| Null-valued fields omitted (contract rule) | 17,332 | 0 |
| Out-link caps reached | 0 | 0 |
| Links: page / ambiguous / missing / external | 55,682 / 67 / 3,742 / 16,012 | 1,277 / 0 / 295 / 2,331 |
| Internal resolution (page ÷ internal links) | 93.6% (58.4% before the profile change in [W-6](#w-6-p3-typed-links-name-record-identifiers)) | 81.2% |
| Cold `host.refresh` / `git` processes started | 136 s / 21,494 | (not separately timed) |
| Cold `openWikiRuntime`, both namespaces | 172.7 s; every call waits | |
| Batched-read prototype (one `cat-file --batch` process) | 13.6 s wall, 15.5 s CPU, identical index | |
| Warm open (snapshot present, same commit) | 3.6 s | |
| Snapshot size per commit | 81,676,090 B | 8,020,876 B |
| Peak RSS of the hosting process | 780–930 MiB | |
| Page ids over the 160-character reference cap / longest | 0 / 143 | 0 / 114 |
| Destinations over the 512-character shell cap; titles over 300 | 0; 0 | 0; 0 |

Missing-target shapes in B: 253 of the 295 missing links point at repository files that are not pages, such as images and code. The rest are page-like names with no match.

### 1.3 Findings

Severity: P1 means the function is broken or unsafe at real scale, P2 a significant gap, P3 a quality issue and P4 cosmetic or data-side. P1s are fixed in this lane. P2–P4 items are recorded here and are not implemented unless they are already specified or the owner directs them.

#### W-1 (P1) A cold index blocks the Wiki and Settings for minutes

**Problem.** `openWikiRuntime` awaits every namespace refresh before it returns. The adapter reads each page with its own `git cat-file blob`.

**Effect on corpus A:**
- A first launch, and every launch after the source advances, blocks for about 3 minutes.
- During that time every Wiki IPC call waits in the bridge's serial queue.
- The Local Wiki check in Settings › Data sources (a `recheck`) reports a failure after its 10 s timeout (`DataSources.tsx`).

**Fix (W1):**
- One persistent `git cat-file --batch` process per source, keeping the fixed prefix and environment, validated OIDs only, and bounded output.
- A runtime that opens without waiting and builds in the background.

#### W-2 (P1) Snapshots grow without bound

**Problem.** `wiki/index-v1/<namespace>-<commit>.json` is written for every new commit and never deleted. Corpus A adds 82 MB per indexed commit.

**Fix (W1):**
- After a successful write, keep only the current snapshot for each namespace.
- Delete a removed namespace's snapshots.
- Clean up orphaned temporary files at open.
- Match exact names only, and never follow symlinks.

#### W-3 (P2) Admin routes wait for the whole rebuild

**Problem.** `saveSource`, `reindex` and `recheck` hold the runtime's serial queue until the full rebuild finishes. F6's Settings design polls `status` every 2 s while a source is indexing, so status must answer during a build.

**Fix (W1):** apply the configuration change at once, return the current status (normally `indexing`), and coalesce queued builds.

#### W-4 (P2) Indexing runs in the Electron main process

**Gap.** The spec calls for worker indexing. Today, parsing, BM25 construction and snapshot JSON for corpus A run in main, which peaks at 780–930 MiB.

**After W1.** Reads become asynchronous and batched, so IPC interleaves between pages. Two synchronous phases still stall the main event loop:
- whole-snapshot `JSON.stringify` after a build;
- `JSON.parse` at warm open (3.6 s in total).

**Proposal.** Move the Wiki host into an Electron `utilityProcess` behind the same closed bridge. It is a specified requirement, so it belongs in this lane. It is sequenced after W1 lands and is measured first.

#### W-5 (P2) Sources must be bare mirrors that nothing updates

**Problem.** The adapter refuses non-bare repositories and never fetches, both by design. The owner's corpora are working checkouts. So the owner must:
- create a bare mirror of each corpus;
- keep it updated, by fetching into it or pushing to it.

Otherwise the Wiki keeps serving an old commit. The UI does show the commit time, and remote freshness is "unknown".

**Options (owner decision):**
- **(a)** Document a mirror recipe and leave the code as it is.
- **(b)** Also accept the `.git` directory of a working checkout and read committed objects only. This keeps the same fixed argv, `core.fsmonitor=false` and no optional locks, never reads the working tree, and is no more exposed than a bare repository's own config.
- **(c)** Add a separate owner-run sync helper outside the app.

**Recommendation.** (b), with (a) documented meanwhile. It changes the adapter's acceptance rule in `ctx.wiki-core-capsule.001`, so it is not made here without that decision.

#### W-6 (P3) Typed links name record identifiers

**Finding.** In corpus A, 35,854 of the 39,596 missing links were exact values of a record-identifier frontmatter field. That field is not a title, path or alias.

**Fix.** Adding it to the profile's alias mapping raised internal resolution from 58.4% to 93.6%, with 67 ambiguous targets. This is an owner-local profile change, not a code change. The private profile records it.

#### W-7 (P4) Source data quality: raw frontmatter

**Finding.** The 147 raw pages in corpus A fall into three categories:
- 104 have a flow list with no space after the colon (`key:[]`);
- 28 have a plain scalar containing `: `;
- 15 have a non-`key: value` line.

All three are invalid YAML, so the raw fallback is correct.

**Fix.** Repair it in the corpus, not in HQ.

#### W-8 (P4) Links to non-page files show as missing

**Finding.** In corpus B these are mostly images and code files.

**Possible fix.** A later contract revision could classify them as `file`. It is recorded, not implemented.

#### W-9 (P3) Revision history is not specified

**Request.** F6's design reserves a History tab with a commit list and word-level diff "when lane B5 adds one".

**What it would take.** It needs at least one new method, such as a bounded `git log -- <path>` list plus reading a page at an earlier commit. That means:
- breaking the closed seven-method contract, preload and IPC membership and their static tests;
- adding `log` to the adapter allowlist.

**Status.** Owner decision. Nothing is built, and no placeholder is shown.

### 1.4 Data-layer work in progress

- **W1:** batched reads, a non-blocking runtime, prompt admin routes and snapshot retention. It fixes W-1 to W-3, without changing the contract, preload or UI.
- **W3:** `modules/wiki/core/scripts/validate-sources.ts`. The owner runs it against a private config, and it reports only numeric, fixed-category aggregates for all seven methods. Privacy is enforced structurally and tested.
- **W4a:** an additive, optional contract revision requested by F6. Old shapes stay valid and the seven methods are unchanged.
  - `BacklinkEntry.via?`: how the source links to the page, either `body` or a relationship field.
  - `BacklinkEntry.excerpt?`: at most 160 characters of inert text around the first body link.
  - `Topic.pageTitles?`: titles aligned with `pages`, so topic previews show titles instead of paths.
  - The snapshot rules version is bumped so stored snapshots rebuild.

## 2. Shared contracts and references

### 2.1 `@hq/contracts`

The package exports `.`, `./services`, `./wiki`, `./wiki-admin`, `./references`, `./design-records`, `./catalog`, `./preview`, `./jones-code` and `./updates`.

- **Domains.** `DOMAIN_IDS` is `design`, `social`, `work`, `wiki`.
- **References.** `ReferenceEnvelope` and `parseReference` are shared unchanged by every reference consumer, as `req.references-closure.001` requires. Their caps are `entityId` ≤160, `title` ≤300, destination ≤512 (`isDestination`) and `sourceRevision` ≤300.
- **Wiki transports.** `WikiServiceTransport` (`./wiki`) is asserted against the Wiki host and module ports at compile time in `modules.tsx`. `WikiAdminTransport` (`./wiki-admin`) types the Settings admin calls.
- **Changes in this lane.** B5 makes no change to `packages/contracts`. W4a's additions are in the Wiki contract module.

### 2.2 Reference round-trip matrix

| Domain | Stores outgoing links (source) | Provider kinds (target) | Status |
| --- | --- | --- | --- |
| Design | No | `project`, `version`, `request`, `reference` (read-only) | Registered |
| Social | Drafts. Saved only when the service advertises `hq-references-v1`; otherwise "not saved — needs Social service support" | `draft`, `run`, `brand` | Registered. No HQ-runnable Social service (B2, #187) |
| Work | Cards, through the Planner. Planner API 2 advertises `hq-references-v1` | `item` | Registered |
| Wiki | Never: Git sources are read-only (RL-1) | `page` (W2) | **Missing** ([R-1](#r-1-p2-owner-directed-wiki-pages-are-not-reference-targets)) |

**Evidence today:**
- shell integration tests (`references.integration.test.tsx`);
- native captures of Social ↔ Work open and Back in isolated Electron (`docs/evidence/hq-integration/reference-round-trip/`, synthetic, zero writes or execution).

The native row `reference-round-trips` remains a gap in the acceptance runner.

#### R-1 (P2, owner-directed) Wiki pages are not reference targets

**Effect.** "Link to…" in Work and Social, and F7's palette built on `ReferencePort.find`, cannot reach the Wiki. This is F7's X9.

**Fix (W2).** `createWikiReferenceProvider` (domain `wiki`, kind `page`):
- **`entityId`:** `pageKeyId` (`<namespace>/<path>`). Ids over the cap are omitted, and none exist in the real corpora.
- **`find`:** uses `search`. An empty query returns nothing.
- **`resolve`:** uses `getPage` and maps to `available`, `changed`, `missing`, `unavailable` or `unknown`.
- **`sourceRevision`:** a content hash of the page, so an unrelated commit does not mark links changed.
- **Execution:** none.

F6 had planned the same file and has been told B5 owns it.

#### R-2 (P1 once R-1 lands) The Planner rejects Wiki targets

**Problem.** `services/planner/planning/validation.py` sets `_HQ_DOMAINS = ("design", "social", "work")` for both target and destination. The desktop's `parseReference` accepts `wiki`.

**Effect.** Saving a Work card that links to a Wiki page fails the whole update with "Reference N has an invalid HQ target".

**Fix.** Add `wiki` to the tuple, add a `domain-wiki` accept vector to the Planner contract vectors, and add a test. B1 owns the Planner, so this is coordinated with B1. B5 opens it as a separate small PR unless B1 takes it.

#### R-3 (P2) Social links cannot be saved through any HQ-runnable service

**Status.** B2 owns the clean-room `services/social` (#187). B2 has been asked to accept `wiki` targets, and to check Fieldnotes for the same three-domain list.

#### R-4 (P3, known deferred) Shell destinations and Wiki destinations have different caps

**Problem.** Shell destinations cap at 512 characters, while the Wiki can represent 16,384. This was already recorded as a P2 root seam in `hq-expansion.md`.

**Real-corpus impact.** None: the longest page id is 143 characters, and no destination exceeds 512. Severity is noted as P3 for references.

### 2.3 Contract coordination with F6 and F7

- **Seven Wiki methods.** Unchanged, as are the admin route, parameter and value shapes.
- **Admin `status` during a build (W1).** It answers immediately, and `saveSource`/`reindex`/`recheck` return `indexing` and finish in the background. Settings should poll `status` until `ready` or a failure state. A cold build of corpus A drops from about 136 s to about 14 s.
- **W4a additions.** Optional and safe to ignore. They let F6's backlink-context preview and titled topic previews work without fetching source pages.
- **Wiki reference provider.** B5 owns it (R-1). F7's palette picks it up through `REFERENCE_PROVIDERS` with no change on F7's side.

## 3. Integration

### 3.1 #179: compose the accepted Design, Social and default-disabled backend source

- **Source facts.**
  - Head `c83294b0309f830fc15e7af31348978a521292d4`, tree `cd862d5ded3afc55f08237b4ba9095f94132d3c1`.
  - Ordered forward merges of #165 → #168 → #166 → #173 → #175 over foundation `0cd50ab`.
  - 34 commits ahead, 0 behind, `MERGEABLE`/`CLEAN`.
  - The six required checks pass on the exact head, reported by T1 in the PR body: foundation 130 Vitest files with 2,042 cases plus 506 Wiki tests, CLI and Planner, and the Design inventory, batch and sections.
- **Assessment.** Source-qualified and land-ready on source signals. No B5 finding affects it: B2 independently found no Social conflict.
  - **Not yet established:** native journeys on its head. The labelled workflow was not requested, and T1 recorded that choice. W5 runs the repository's runner on this host. The results go in [§4.1](#41-what-this-linux-host-verifies).
  - **Merge and disposition.** Merging, and the automatic disposition of the foundation-reachable originals it enables, are held for the owner's decision as the PR states.
- **Successor.** None needed unless W5 finds a defect.

### 3.2 What blocks foundation #2 from leaving draft

Exit requires `ac.working-app.001` and `ac.capability-closure.001` on one exact head, then `ac.main-delivery.001`. Open items:

1. **Native rows are gaps or held** (`ac.working-app.001`, Electron harness). Twelve reserved rows remain obligations. HQ-02 and HQ-03 now exercise two of them (`work-service-replay` and `work-restart-without-intent`), which pass only when observed. The other ten have no native scenario: `social-save-and-unknown`, `reference-round-trips`, `wiki-committed-corpus`, `unavailable-service-ui`, `import-export`, `capability-closure`, `preview-qualification`, `component-containment`, `new-thread-qualification` and `integrated-scenario-catalog`. HQ-07, HQ-09 and HQ-09H are source rows (HQ-07 image edge held; HQ-09H held without a distinct-host binding). Full mode is nonzero by design until they are discharged.
2. **Seven held capabilities** (`req.held-capabilities.001`): live S1 receiver, new-thread U1, S2 preview, component execution, Wiki private validation, service enablement and laptop installation. Each qualifies only through its own gate, at real native evidence.
3. **No capability-closure matrix** (`ac.capability-closure.001`) exists on any exact head.
4. **Service enablement** (`ac.service-enablement-binding.001`): the owner must approve the Planner and Social `hq-references-v1` envelopes and enter the endpoints. No HQ-runnable Social service exists yet (B2).
5. **Original-PR disposition audit** (`ac.main-delivery.001`). 42 PRs are open, 32 of them against `work/hq-foundation`, including the HQR-A1–A10 review series and the T1 storage and evidence stacks. #179's ancestral merge would dispose of #140, #161, #162, #165, #166, #168–#171 and #173–#175 automatically, and that decision is held for the owner.
6. **Laptop route** (`ac.laptop-route-binding.001`): the owner identifies the laptop, an unsigned build and install route exists, and any packaging configuration lands by amendment. None is active.
7. **#2's description is stale.** It describes the 25-test three-domain bootstrap. It should be rewritten at the final candidate.
8. **Authority.** Merging #2, advancing foundation to `main` and closing originals all need the owner's separate decision. The 24 October authorization excludes them.
9. **Host (B4, #188).** Under this VPS's `umask 0002`, #182's storage admission refuses builds and tests in every T3 worktree. It does not affect foundation or #179 today, but it must be fixed before #182 lands, or local verification stops.

### 3.3 Other PRs in this lane's brief

- **#138 (run native acceptance on macOS).** Its head `1a268db` is already an ancestor of foundation through #167, so the PR has 0 commits left to merge. What remains is the actual Mac execution ([§4.2](#42-what-needs-the-owners-mac)). Closing or retargeting it is the integration owner's call.
- **#115 (native distribution and updater requirements).** Preparation only, a draft, docs only (`hq-native-updates.md`, 3 commits ahead). No action until distribution is authorized.
- **#86 (HQR-A7, CLI transport).** Mergeable and clean, but 509 commits behind foundation. It is in the Planner and CLI area. Its disposition is part of item 5 above, with B1.

## 4. Native acceptance

### 4.1 What this Linux host verifies

- **Host.** 16 vCPU, Xvfb, bubblewrap 0.12 and unprivileged user namespaces are present (per B4). Electron 44.9.0 installs through `node node_modules/electron/install.js` after `npm ci --ignore-scripts`.
- **Runnable here:**
  - the B group (inventory, fixtures, scenarios, host gallery and cleanup tests);
  - `--checkpoint` (shell, preload, CSP, mounted domains and restart persistence);
  - `--routine`: HQ-01 launch, domains and restart; HQ-02 capture, uncertain write and lookup; HQ-03 Work restart; HQ-09 gallery last-good;
  - `--selected` (nonzero at HQ-07's held image edge);
  - full mode (nonzero while the rows in [§3.2](#32-what-blocks-foundation-2-from-leaving-draft) remain).
- **Results on #179's head.** Pending W5, which runs them serially after admission and reports every row.

### 4.2 What needs the owner's Mac

- **Darwin runner execution.** #138's source support is in foundation, but no Darwin run is recorded.
- **Recipe**, on the exact candidate in a graphical session with Git and `python3` (from `tests/acceptance/README.md`):
  1. `npm ci`
  2. `node node_modules/electron/install.js`
  3. `npm run build`
  4. `node --test tests/acceptance/cleanup.test.mjs`
  5. `node tests/acceptance/run.mjs --checkpoint`, then `--routine`, then `--selected` (expected nonzero), then full (expected nonzero)

  Evidence is local and may contain paths, so sanitize it before publishing. Darwin gives process-group cleanup, not namespace containment.
- **HQ-07's displayed preview image and native chooser.** Release obligations: the held seam is `modules/design/app/compose/bridged-workspace.ts` `thumbnails.readThumbnail`.
- **Laptop installation, signing and notarization.** These sit behind the laptop-route predicate and separate authority. #115 is preparation only.
- **Wiki on the Mac.** Configure it in Settings › Local Wiki with the owner's private profiles and bare mirrors ([W-5](#w-5-p2-sources-must-be-bare-mirrors-that-nothing-updates)). The native `wiki-committed-corpus` row also needs a scenario first. That scenario is planned after the T1 acceptance-runner stack (#176 → #178 → #180) settles, to avoid overlapping writers in `tests/acceptance`.

### 4.3 What needs owner authorization

Each of these needs the owner's explicit predicate, never a fixture or simulation standing in:
- service enablement (Planner and Social endpoints);
- live S1 receiver;
- new-thread U1;
- S2 preview;
- component execution;
- Wiki private validation binding;
- laptop route.

## 5. B5 workstreams

All builders are Claude Sonnet 5.5 (xhigh), each in its own worktree from `origin/work/hq-foundation` at `0cd50ab` (W5 from #179's head). Each diff gets a lead review and an independent reviewer pass before its PR opens.

| ID | Branch | Scope | Status |
| --- | --- | --- | --- |
| W1 | `work/hq-b5-wiki-runtime-20261103` | Batched Git reads, non-blocking runtime, prompt admin, snapshot retention (W-1 to W-3) | Running |
| W2 | `work/hq-b5-wiki-references-20261103` | Wiki reference provider, registration, shell integration test (R-1) | Running |
| W3 | `work/hq-b5-wiki-validate-20261103` | Owner-run private validation tool, aggregates only (WK-PV) | Running |
| W4a | `work/hq-b5-wiki-graph-context-20261103` | Additive backlink provenance, excerpt and topic titles | Running |
| W5 | `work/hq-b5-verify-179-20261103` (no commits) | Native runner on #179's head on this host | Running |
| Planned | — | Planner `wiki` domain (R-2, with B1); `utilityProcess` Wiki host (W-4); native Wiki scenario (§4.2) | After the above |

## 6. Validation so far

- **Repository state.** `git fetch` and readback of every PR head named above, plus `gh pr checks 179` (six passes).
- **Real-content run.** The production runtime on both corpora, with all seven methods and admin `status` succeeding. Timings, process counts and sizes are as in §1.2, and only aggregates are recorded here.
- **This document.** It changes no source, tests or workflows.
