# B5 lane handoff — HQ backend: Wiki, contracts and references, integration, native acceptance

Artifact Type: handoff

Lane: B5, the HQ backend for the Wiki, shared contracts, cross-module references, whole-app integration and native acceptance readiness. Lead: Claude Opus 5.5. Builders and reviewers: Claude Sonnet 5.5 (xhigh), run as T3 delegated tasks.

Paused: 2026-11-03, about 15:00 UTC, on the owner's request relayed by the HQ coordinator. This handoff was finished at about 15:20 UTC.

Authority effect: none. Nothing was merged, labelled, dispatched, installed or released.

## Status

1. **Done.** The assessment is published, and the Wiki reference provider (W2) and the additive backlink and topic contract (W4a) are built and pushed. Native routine and checkpoint tiers pass on #179 on Linux (W5).
2. **Not finished.** W1 (Wiki runtime at real scale) did not answer the stop message and was cancelled. Its two commits are pushed but unreviewed. It left no handoff, so the lead summarizes it [below](#w1-wiki-runtime-cancelled-without-a-reply). W3 (private validation tool) is built but not yet reviewed, and its handoff is linked below. All three independent reviews were stopped early and replied with partial results: no P0 or P1 so far, and five P2s. No B5 PR is open yet.
3. **Next.** Complete the reviews, then open PRs for W2 and W4a, then W1 and W3. Record P2–P4 findings for the owner instead of fixing them. Run W3 on the owner's corpora (aggregates only) only after the owner confirms that authorization. Then update and open the assessment PR.

## Where everything is

Worktree directories are under the T3 worktrees root for the HQ project, `<t3 worktrees>/HQ/<dir>`.

| Item | Branch | Head | Worktree dir | PR | State |
| --- | --- | --- | --- | --- | --- |
| Lane assessment | `work/hq-backend-wiki-integration-20261103` | `9c6d365` before this handoff | `work-hq-backend-wiki-integration-20261103` | none | Published early. Its independent review was stopped (see [Reviews](#reviews-stopped-at-the-pause)). Needs the updates listed in [Next steps](#whats-left-in-priority-order) |
| W1 Wiki runtime: batched Git reads, non-blocking open, prompt admin, snapshot retention | `work/hq-b5-wiki-runtime-20261103` | `4d99160f7fd364e8c8538739cbd037b00dd30197` | `work-hq-b5-wiki-runtime-20261103` | none | Cancelled at the pause after it gave no reply. It wrote no handoff file. Its two commits are pushed, and the worktree is clean and matches the remote. Unreviewed. See [W1](#w1-wiki-runtime-cancelled-without-a-reply) |
| W2 Wiki reference provider | `work/hq-b5-wiki-references-20261103` | `1566ca6b5f849c6726b0938d3d62629c7c1c8624` | `work-hq-b5-wiki-references-20261103` | none | Built; lead review found no blockers; independent review stopped |
| W3 Wiki private-source validation tool | `work/hq-b5-wiki-validate-20261103` | `38fe4ea221e2b756479aa095327aa68948126953` | `work-hq-b5-wiki-validate-20261103` | none | The tool and its tests are complete. The checks were run at `b0f7722` (scripts 129 pass, `@hq/wiki` 635 pass, tsc exit 0). They were not re-run after the README-example commit. Not run on real sources yet; no lead review yet. Handoff: [`b5-backend-wiki-integration/hq-b5-wiki-validate-20261103.md`](https://github.com/Jones-Systems/HQ/blob/38fe4ea221e2b756479aa095327aa68948126953/docs/handoffs/hq-life-20261103/b5-backend-wiki-integration/hq-b5-wiki-validate-20261103.md) on its branch |
| W4a additive contract: backlink `via`/`excerpt`, topic `pageTitles` | `work/hq-b5-wiki-graph-context-20261103` | `0a5f819b6b6cd7cb68df19bd67d4ef1b77db4ae1` | `work-hq-b5-wiki-graph-context-20261103` | none | Built; lead review found it sound, with one design concern; independent review stopped |
| W5 native verification of #179 | `work/hq-b5-verify-179-20261103` (no commits) | `c83294b0309f830fc15e7af31348978a521292d4` (#179) | `work-hq-b5-verify-179-20261103` | n/a | Done. Evidence is local only. `node_modules` (436 MB) and the build are kept for reuse |

**Not started:**
- the Electron `utilityProcess` Wiki host (finding W-4);
- the native `wiki-committed-corpus` scenario;
- the owner decisions listed below.

The Planner `wiki` reference domain (R-2) is owned by lane B1, which will open its own PR.

## Subagents summarized by the lead

### W1 Wiki runtime (cancelled without a reply)

**State.**
- Its last recorded activity was at about 14:44 UTC, when it committed and pushed. The stop message arrived at 14:59:33 UTC and was never answered. The lead cancelled the task at about 15:12 UTC, as the pause instruction requires after about 10 minutes.
- It wrote no handoff. Its branch, the remote and its worktree all point at `4d99160`. Nothing is uncommitted, and no W1 process is left running.

**What it built (unreviewed).** Eight files, +1,497 −87, on base `0cd50ab`.
- **`926ef9d`, Wiki core (part of W-1).** One lazily started `git cat-file --batch` child per source now serves page reads. Before, every page started its own process.
  - It keeps the same fixed argv prefix, minimal environment, `shell:false`, and the real Git directory as cwd.
  - Only validated ids go to stdin, one request at a time, and each reply header is checked against its id.
  - An oversized object kills the child before its body is read. A framing error, an exit or a timeout kills the child and fails only that read; the next read starts a new child.
  - The child closes after 1.5 s idle. The README allowlist and `static.test.ts` now name `cat-file --batch`.
- **`4d99160`, desktop runtime (W-1, W-2, W-3).**
  - `openWikiRuntime` returns without waiting for indexing, and refreshes run one at a time in a background chain.
  - Admin routes keep their validation, revision check and `resolvePin` check. They then return status at once, showing `indexing` while a refresh is queued or running, and repeated requests coalesce.
  - A configuration change retires the old host: its Git processes are killed and its snapshot writes are refused. `close()` aborts the build in flight and resolves only when nothing can write any more.
  - **Retention deletes files.** After a snapshot is written, the namespace's other `index-v1/<namespace>-<hex>.json` regular files are deleted. Removing a source deletes its snapshots. Opening deletes orphaned `<name>.<uuid>.new` files of the exact `atomicWikiJson` form. Links, directories and other names are left alone.
  - The test seam is `openWikiRuntime(userData, { git })` plus a non-IPC `whenIdle()`.
- Its commit message says the tests that assumed open or an admin route had finished indexing now wait for the background work, and that no assertion was removed or weakened. The lead has not verified that.

**Checks, from its scratch output** (Node 24, under the CPU admission gate):
- `npm run typecheck`: exit 0, at 14:35 UTC.
- Full Vitest: 118 files and 1,883 tests passed at 14:41 UTC. That run was about three minutes before the commits, and it was not re-run on the committed head.
- The two `npm test` runs before it (build plus Vitest) failed only on 5 s test timeouts while the host was loaded, with 2 and then 16 failures.
  - The two failures in the first run were whole-App renders, such as the "restores view, filters, selection…" case in `modules/work/nav/test/registry.test.tsx`.
  - A clean `npm test` was not observed.

**Not done.**
- The synthetic before/after `git` process counts its brief asked for. It was measuring them at the pause.
- Real-corpus timing, which needs the owner's confirmation (open question 1).
- Lead review, independent review and the PR.

**Review focus.**
- The new deletion paths: exact names only, regular files only, and containment under `userData/wiki`.
- Races between `close()` or host retirement and in-flight snapshot writes.
- The stdin protocol under oversized objects and timeouts.
- Whether those test timeouts came from host load or from the background refresh.

### W2 Wiki reference provider (`1566ca6`)

**What it does.**
- `modules/wiki/app/src/references.ts` holds `createWikiReferenceProvider(service, now)`:
  - domain `wiki`, kind `page`, `entityId` = `<namespace>/<path>`;
  - `find` runs `search`, then one `getPage` per hit to compute the content revision;
  - `resolve` runs `getPage` and maps the result to available, changed, missing, unavailable or unknown;
  - no `targetProjectId`, no writes and no execution.
- The revision is `wiki-c1:` plus the SHA-256 of the canonical JSON of `{byteLength,title,fields,content}`. An unrelated commit therefore leaves a link `available`.
- It is registered in `apps/desktop/src/reference-providers.ts`.

**Tests.**
- New `modules/wiki/app/test/references.test.ts` (29 tests).
- New `apps/desktop/src/wiki-references.integration.test.tsx`, which drives the real `App` and real Wiki runtime over the synthetic bare-repo corpus. It checks these paths:
  - Work card, "Link to…", Wiki page, save through the Planner fixture;
  - open the page, then Back restores the card;
  - Changed and Missing links render correctly;
  - zero execution.
- One existing assertion changed legitimately: the registry list in `apps/desktop/src/references.integration.test.tsx:142` now includes `wiki`.

**Builder's checks** (Node 24.19.0):
- Wiki app: 140 pass.
- Other Wiki suites: 395 pass.
- tsc and `npm run typecheck`: exit 0.
- `npm test`: 118 files, 1,876 pass.

**Builder's findings:**
- **P3:** `find` costs up to 50 `getPage` calls through the serial Wiki bridge.
- **P3:** `parseReference` caps are restated, because the Wiki package may not import `@hq/contracts`. A test pins the restatement.
- **P4:** a destination over 512 characters cannot be referenced.
- **Disclosed:** one short mutation run was started at 93.55% CPU, above the 85% admission limit.

**Alternative.** Lane F6 had started the same provider before handing it to B5. Its unreviewed branch `work/hq-life-wiki-w3-20261103` at `dbdd5bb` (base `d2711c7`) includes screenshots. Compare it before opening the PR, and keep W2 unless F6's is clearly better.

### W4a additive Wiki contract (`a4ec7de` contract, `0a5f819` core)

**Contract.** `BacklinkEntry.via?` (1–8 sorted origins: `body` or a relationship field name) and `excerpt?` (at most 160 units, inert). `Topic.pageTitles?` is aligned with `pages`. The validators stay closed, old payloads still validate, and the seven methods are unchanged.

**Core.** Each snapshot page carries `linkOrigins`. `INDEX_RULES_VERSION` goes 1 → 2, so stored snapshots rebuild. `parseSnapshot` re-checks the origins strictly, and snapshots stay byte-identical.

**Builder's checks:**
- contract: 75 pass;
- core: 274 pass;
- UI and app: 224 pass;
- tsc and typecheck: exit 0;
- `npm test`: 1,873 pass.

**Size cost.** About 180–200 bytes of snapshot per unique (source, target) page pair.

**Deviations, disclosed:**
- One core test run was started at 97.7% CPU.
- The builder's report said nothing in `apps/` persists snapshots. That is wrong: `apps/desktop/electron/wiki-runtime.mts` persists them. The committed README does not repeat the error.

**Builder's findings:**
- **P4:** the excerpt starts at the start of its block, so a long paragraph can cut it before the link. The independent review rates this P2 (W4a P2-1 in the [reviews table](#reviews-stopped-at-the-pause)).
- **P4:** a relationship field named `body` is indistinguishable from a body link.
- **P4:** `docs/evidence/hq-wiki/README.md` and `modules/wiki/ui/README.md` still say topic previews carry keys only.

**Lead's design concern.** The excerpt should be a window around the link, not a cut from the start of the block, and the independent review reached the same conclusion on its own. Under the P2–P4 rule, whether to change it is the owner's choice. It is cheaper to decide before F6 adopts `excerpt`: changing it later needs another rules-version bump and a full rebuild of stored snapshots.

### W5 native Linux verification of #179 (evidence only)

**Identity.** Head `c83294b`, tree `cd862d5`, a descendant of foundation `0cd50ab`. Node 24.19.0, Electron 44.9.0, Xvfb, bubblewrap 0.12.0 and user namespaces present. Nothing was bypassed.

**Results:**
- **Install and build:** `npm ci --ignore-scripts`, the Electron installer and `npm run build` all exit 0.
- **B group:** 22/22 pass.
- **Checkpoint:** exit 0.
- **Routine:** the first run failed with "Timed out: Electron CDP" at `tests/acceptance/run.mjs:120`. It used the 20 s default wait at `tests/acceptance/runtime.mjs:78`, while host load was about 160 on 16 cores. The one allowed rerun passed (exit 0, 10 s).
- **Selected and full:** both exit 1, as expected.

**Row matrix:**
- **7 pass:** `native-prerequisites`, `renderer-isolation`, `domain-round-trip` (Design, Social, Work and Wiki mounted), `shell-restart`, `work-service-replay` (HQ-02), `work-restart-without-intent` (HQ-03) and `remote-gallery-source` (HQ-09).
- **10 gaps (no native scenario):** `social-save-and-unknown`, `reference-round-trips`, `wiki-committed-corpus`, `unavailable-service-ui`, `import-export`, `capability-closure`, `preview-qualification`, `component-containment`, `new-thread-qualification` and `integrated-scenario-catalog`.
- **2 held:**
  - HQ-07: the displayed image and native chooser. The seam is `modules/design/app/compose/bridged-workspace.ts` `readThumbnail`.
  - HQ-09H: no distinct-host binding.

**Cleanup.** Cleanup passed in every run. Evidence is in that worktree's `.t3/acceptance-evidence/run-*`; it is local and may contain paths. The scratch cache was removed.

**Verdict.** Nothing in this evidence contradicts #179 on Linux. #2 stays blocked by the gaps and held rows, which are independent of #179.

## Reviews stopped at the pause

Each review ran in its own delegated task. Its findings so far are summarized here; the full text is in the lane thread.

| Target | Review state at pause | Findings so far |
| --- | --- | --- |
| Assessment `9c6d365` | Stopped and replied: incomplete, needs fixes; P0 0, P1 0, P2 2, P3 6, P4 5. **Privacy:** it found no private content, ids, paths, refs or URLs in the document | **P2:** the "58.4% before" internal-resolution figure is inconsistent with the document's own counts. It equals page-after ÷ (page-after + missing-before), so the true before-figure is probably about 33%. Recompute from the raw before and after counts. **P2:** the private-corpus run and its aggregate publication rest on an inferred authorization ("I take that as the owner's direction"). `AGENTS.md` requires exact separate authorization for private-data access. **Next step:** get the owner's explicit confirmation, or hold §1.2. **P3:** W-6 describes a private field's role, so generalize it. The runtime opens on the first Wiki call, not at launch. Reconcile 173 s against 136 s, and label the 21,494 processes as corpus A. R-2 and W-4 wording overreaches lane authority: W-4 worker indexing is a root step, so confirm with T1 first. Name the Wiki-contract acceptance owner for W4a, and note W3's root-release gate. W-2 is more defensible as P2. W-5 option (b) understates checkout risks (hooks, includes). **P4:** say "stack roots" for the T1 stacks; add B3 (#189) to the consumers; spell out the service-enablement predicate in full; add the admission and scratch variables to the Mac recipe; byte sizes could be rounded |
| W2 `1566ca6` | Stopped and replied: incomplete; P0 0, P1 0, P2 2, P3 2, P4 4. Findings were verified by reading only; nothing was run | **P2-1:** read amplification. `packages/hq-ui/src/references/LinkPicker.tsx` re-runs `find` (limit 30) on every keystroke without debounce or cancellation, and each `find` issues up to 30 `getPage` reads through the one serial Wiki bridge. **Fix:** share in-flight revision reads per page, skip reads for superseded finds, or cap revision reads at about 10. **P2-2:** the `wiki-c1` token hashes the parsed AST, which embeds resolved link targets. Adding, removing or renaming a page that a link points to therefore marks an unchanged page `changed`. The docs overstate "only its own content", and the test uses an empty commit. **Fix:** correct the docs and add a tree-changing test. The real fix is a contract-exposed blob digest. **P3:** `envelopeFor`'s `pageKeyEquals` guard is untested; no real-corpus content edit is shown to read `changed`; one assertion in the integration test is vacuous. **P4:** Wiki is starved in the picker when Work alone fills the limit of 30; no `changed` without a `sourceRevision`; the `crypto.subtle` dependency (Design already uses it); title truncation is unreachable at the contract's 256 label cap. **Not checked:** preload exposure, Social's flow, real timings, hosted CI |
| W4a `0a5f819` | Stopped and replied at 15:01 UTC: incomplete; P0 0, P1 0, P2 1, P3 1, P4 7. Findings were verified by reading only; nothing was run | **P2-1:** the excerpt is the first 160 units of the block (`blockContext` in `modules/wiki/core/src/draft.ts`), so in a long paragraph it leaves out the link. The test "is cut at the cap" pins this. **Fix:** track each link's offset in `collectInline` and take a window around it, snapped to whitespace and surrogate boundaries, with a leading "…". Soften the contract wording to "the part of the block around…". **P3-1:** the contract README says this host omits `via` for older stored snapshots, but it never does. `parseSnapshot` requires at least one origin, and the rules bump rebuilds old snapshots. Reword it to say consumers must tolerate an absent `via`. **P4:** the flat-scan fallback merges tight list items into one excerpt. The field-name rule is defined in three places. `via` shows relationship field names to the renderer; `getPage` `fields` already shows them. Excerpts allow bidi and zero-width characters, as titles do, so the UI must render them as text. Table-row excerpts carry no header context. `createNamespaceIndex` lost its namespace guard, which makes no difference for validated snapshots. The real-scale cost is unmeasured; the reviewer estimates about 10–11 MB for 55k pairs. The spec and the evidence README are not updated. **Not checked:** `client.ts`, strict equality in unchanged tests, desktop IPC caps, the Markdown block and inline modules, and any measurement. **Provisional verdict:** no P0 or P1; the contract and core look correct, closed and deterministic |

## Decisions and why

- **Builder boundaries.** They avoid colliding with other lanes. W1 changes no contract, preload or UI. W4a is additive only and never edits `modules/wiki/ui/src`, which F6 owns. The views belong to F6, and B5 changes only data and contracts.
- **Wiki references.**
  - The Wiki is a reference target only, never a link source, because its Git sources are read-only (RL-1).
  - The revision is content-based, so unrelated commits don't mark links changed.
  - B5 owns the provider. F6 cancelled its duplicate.
- **History.** Wiki "history" is in-session navigation, as `hq-expansion.md` specifies. Revision history and diffs would add service methods to the closed contract, so they need an owner decision. F6 agreed: no History tab and no placeholder.
- **Planner `wiki` domain (R-2).** B1 owns it because the fix spans the Planner validator, `tools/hq-cli/src/schema.ts:33` `referenceDomain`, Work's pinned contract vectors (`modules/work/live/test/contract/`, the `SUMS_SHA256` constant in `modules/work/live/test/contract.test.ts`) and `docs/engineering-specs/hq-agent-cli.md` line 229.
- **No label or dispatch on #179.** The integration owner (T1) explicitly chose not to label it, so B5 ran the native runner locally instead (W5).
- **The native Wiki scenario waits.** T1's stack #176 → #178 → #180 rewrites `tests/acceptance/run.mjs` and the README. A parallel writer would conflict with it.
- **Real-content run.** I read the brief's "against real local content" as the owner's direction for an owner-local run under exactly the WK-PV privacy scope: aggregates only, and scratch kept outside `/tmp`, owner-only. See material assumption 1 in the assessment.
- **Review findings.** P0 and P1 findings block delivery and are fixed. P2–P4 findings are recorded and given to the owner after delivery, and nobody works on them until the owner chooses. This is the shared review-finding disposition rule.
- **W1 was cancelled, not committed by the lead.** W1 gave no reply within about 10 minutes, so the lead cancelled it as the pause instruction says. Its work was already committed and pushed, so nothing needed rescuing.

## Findings so far

The full set is in [`docs/engineering-specs/backend-assessment-integration-20261103.md`](../../engineering-specs/backend-assessment-integration-20261103.md):
- Wiki: W-1 to W-9.
- References: R-1 to R-4.
- Integration: §3.
- Native acceptance: §4.

**Added since that commit.**
- **R-2 is wider than first written.** The agent CLI schema and Work's pinned vectors must change with the Planner; B1 owns all of it.
- **W5 matrix.** It is above, and is not yet in the assessment's §4.1.
- **Native harness risk.** The fixed 20 s Electron and CDP waits in `tests/acceptance/runtime.mjs` fail under heavy host load. One flake was observed. Hosted runners are less exposed.
- **Process deviation (privacy).** The lead's probe kept its scripts and the private source profiles in `/tmp`, mode 664, for about an hour. On this single-owner host they were then moved into the owner-only scratch, at mode 600 and 700. Nothing left the host, and nothing private is in the repository.
- **Builders started short tests above the 85% CPU limit.** The W2 and W4a builders each did so once. The W3 builder did so twice, for single short runs against synthetic data. All three disclosed it.
- **CI typecheck gap (from W3, P3, needs the root owner).** Root `npm run typecheck` runs `@hq/wiki`'s `tsc -p tsconfig.json`, which includes only `app/src`, `app/test` and `app/fixtures`. Core and contract sources are therefore checked only where `app` imports them. `core/test`, the new `core/scripts`, and the other test directories outside `app` are not typechecked in CI, and no workflow runs `tsc -p modules/wiki/core/tsconfig.json`. The lead checked this against the tsconfig and package scripts.

## What's left, in priority order

1. **Complete the three reviews.** All three stopped incomplete. Re-run each as a fresh delegated task, passing on its prior findings and its "not checked" list.
   - Fix any P0 or P1. None has been found so far.
   - Open PRs against `work/hq-foundation` for W2, then W4a (`gh pr create --head <branch> --base work/hq-foundation`). List the recorded P2–P4 findings in each PR body.
   - Link and watch each PR from the lane thread. A subagent cannot watch a PR.
   - Tell F6 when W4a is reviewed. F6 will switch its reader and topics to `via`, `excerpt` and `pageTitles`.
   - Bring these P2 choices to the owner, and do not fix them without the owner's direction:
     - **W4a P2-1, the windowed excerpt.** It is cheaper to decide before F6 adopts `excerpt` (see W4a above).
     - **W2 P2-1, read amplification in the picker.** The option is to bound the revision reads per `find` and share them across keystrokes.
     - **W2 P2-2, the revision token.** The option is to correct the docs and add a test that changes the tree. The lasting fix is an additive contract member, such as a content digest on `Page` or `SearchHit`. The revision would then stop depending on resolved link targets and would need no `getPage` per hit.
2. **W1.** Start from its summary [above](#w1-wiki-runtime-cancelled-without-a-reply) and from its brief, which is the first message in its thread.
   - Re-run `npm test` on `4d99160` below the CPU limit, and record the synthetic before/after `git` process counts.
   - Then do a lead review, an independent review using the review focus above, and the PR.
   - After the owner confirms (open question 1), re-measure the cold open on the owner's corpora, aggregates only. The target is about 14 s cold, against the original 136 s refresh and 173 s open.
   - Confirm that `status` answers while indexing, and that one snapshot is kept per namespace.
3. **W3.** Resume from its handoff:
   - Re-run the static tests at `38fe4ea`.
   - Lead review, then an independent review that tries to break the privacy schema.
   - Open the PR, and compare the Foundation CI time (the new suite adds about 15–40 s).
   - Only after the owner confirms the private-run authorization (open question 1), run it against the owner's local mirrors, aggregates only. Replace the probe numbers in §1.2 of the assessment, which also fixes the 58.4% figure.
   - Then delete the private scratch, as WK-PV requires.
4. **Assessment update.**
   - Add what has happened since the commit: the W5 matrix in §4.1, R-2 under B1 with its wider scope, and the `/tmp` deviation.
   - Record the doc review's P2–P4 findings in the PR body for the owner, and do not fix them without the owner's direction:
     - recompute or remove "58.4%" (W3's real run would replace it anyway);
     - generalize W-6;
     - say "first Wiki call";
     - reconcile the timings;
     - soften R-2 and W-4 to proposals, confirming W-4 with T1;
     - name the contract-acceptance owner for W4a, and note W3's root-release gate;
     - reconsider W-2 at P2;
     - qualify W-5 option (b);
     - apply the P4 wording fixes.
   - Complete the doc review, then open the PR (a draft is fine until the results are in), then link and watch it.
5. **W-4.** Move the Wiki host into an Electron `utilityProcess` behind the same closed bridge. Do this after W1 lands, and measure the main-thread stalls first. The spec calls for worker indexing.
6. **Native `wiki-committed-corpus` scenario.** Write it in `tests/acceptance/scenarios/` with minimal `run.mjs` wiring, after T1's evidence stack settles.
7. **Owner and integration-owner decisions** (do not build without them):
   - W-5: allow a working checkout's `.git` directory, or document a bare-mirror recipe.
   - W-9: revision history.
   - Whether the owner-local run counts toward the held "Wiki private validation" gate.
   - #179 merge and the disposition of the originals it carries.
   - Whether to close or retarget #138, whose head is already in foundation.

## Open questions and risks

1. **Owner: private-corpus authorization.** The lead ran the production Wiki runtime against the owner's two local corpora and published aggregates only. This rested on the brief's "make its data layer function against real local content". `AGENTS.md` requires exact separate authorization for private-data access, and the private-validation predicate requires an exact privacy scope.
   - Please confirm, or withdraw, authorization for owner-local runs that publish aggregates only, as WK-PV specifies.
   - If it is withdrawn, hold §1.2 of the assessment and delete the private scratch.
2. **Who accepts W4a.** The integration owner or the Wiki continuity owner must accept the additive Wiki-contract revision.
3. **Who owns W-4.** Worker indexing is specified as a root-integration step, so its ownership needs T1's agreement.

- **Host overload.** The VPS hit load of 160 or more on 16 cores, and processes were OOM-killed, including an F6 builder. Native timing flakes under that load.
- **Host umask (B4, #188).** `umask 0002` breaks `tools/storage` admission after #182.
- **Merge conflicts to expect:**
  - W1 and W4a both edit `modules/wiki/core/README.md`;
  - W2 and F6's base both edit `modules/wiki/app/src/index.ts` (one export line);
  - W4a changes core types that W1's adapter tests may import.

  All should be trivial.
- **Snapshot size.** W4a adds about 200 bytes per page pair. For the large corpus that is estimated at about 10 MB on top of the measured 82 MB per snapshot. It is unmeasured until W3 runs on real data. W1's retention keeps only one snapshot per namespace.
- **Mirrors go stale.** The Wiki reads bare mirrors that nothing updates (W-5). Until the owner decides, the Wiki keeps showing the commit it last indexed.

## Exists only outside the repository

- **Builder and reviewer briefs.** Each is the first message of its delegated task's thread. A copy of the builder briefs is in the lead's `/tmp` (public-safe text).
- **Private data.** The private source profiles, the bare mirrors and the probe outputs are in an owner-only directory under the lane's private state on the VPS. The path is recorded in the lane thread, not here. Delete it after W3's real run, or if the lane is cancelled.
- **Coordination (in the threads):**
  - F6 owns the views. It will adopt W4a once reviewed. No History tab. Settings polls `status` every 2 s for up to 2 minutes.
  - B1 owns the Planner, CLI and Work-pin fix for the `wiki` domain, and will send its PR link.
  - B2 was asked to accept `wiki` targets in its Social service and to check Fieldnotes.
- **W5 native evidence.** Local only, in W5's worktree. Sanitize it before publishing.
- **W1 scratch.** `/tmp/b5w1` holds its CPU admission script, its commit-message drafts and its test outputs, all from synthetic data. Delete it once W1 resumes or the lane is cancelled.
- **Review replies.** Each stopped review's full reply is in its delegated-task thread. The summaries above are condensed, so use the replies when re-running a review.
