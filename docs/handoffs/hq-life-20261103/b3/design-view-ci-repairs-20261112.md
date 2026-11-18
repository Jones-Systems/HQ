# Design view CI source repairs

Artifact type: lane-receipt
Authority effect: none
Date: 2026-11-12
Owner: bounded Design view repair builder; sole Git owner of the assigned isolated task branch
Repository: Jones-Systems/HQ
Branch: `work/hq-recovery-design-view-ci-repairs-20261112`
Base: `ef1d0395efef1786d22a7c04f47fe55a40fbebdc`

## Binding and evidence

Canonical origin, assigned linked worktree, branch, exact base and clean initial status were read before mutation. Literal tracked paths matched the three test files and four conditional production grants. No other checkout was modified. The local shared bridge is absent; no enrollment or installation was attempted. Read the HQ bootstrap, recovery amendment in `hq-integration-parallel-execution.md`, recovery Work Note and affected Design core UI map. Maintained frontend guidance was read at `b59d310cae8472ae8ed42d4d8562d08c362379d8`, including the view-map and layout guides. This repair changes no presentation or production implementation.

Input failure evidence: Design run `43255778328`, job `131313643448`; reported inventory, typecheck and app Node tests passed, with exactly the three selected Vitest failures. Those are supplied historical results, not results of this candidate. Current source was traced before each repair. No independent reproduction was run under this source-only assignment.

## Diagnosis and retained oracles

1. **Fresh saved Request source.** `closure-views.tsx` maps current version labels, capture route and viewport into `SourceVersionChoice`; a nonempty source revision makes the choice eligible. `SourceVersionPicker.tsx` intentionally renders a labelled radiogroup and radio rows, not select options. The fixture saves labels `Version v1` / `Version v2` with `/main · 320×640`. The old option-role assertion is obsolete. The repaired test targets those exact accessible radio names inside the same picker, checks exact IDs and eligibility, clicks the newly saved choice and proves it alone becomes checked. Fresh save plus source revision must still become selectable without replacing the picker. Runs shares the loader, but this existing mounted test exercises Requests; it does not newly qualify Runs.
2. **Annotations suspension.** `useDesignProject` falls back to the supplied context because this workspace has no active project. Selection initially is absent and the feed revision is zero. The fake accessor keys by project ID, selection-or-null and explicit-or-feed revision; omitted and explicit zero therefore address the same cached promise. Its async session projection returns the exact choices and a version-pinned controller/target, rather than allocating a promise on every render. The fixture awaits the raw promise outside React, then previously rendered through synchronous testing-library `act`; resolving a JavaScript promise does not itself flush React's `use()` suspension and commit work. The source-supported repair uses awaited async `act` for initial render and the selection transition, matching the async render pattern already used in `content-views.test.tsx`. Added promise identity assertion exposes a future cache-key mismatch; full ordered option IDs/labels, default selected target, changed exact value, pinned-version notice and accessor target assertions preserve and strengthen the original choice/pinning oracle. No production infinite-suspension defect is established by source inspection; the Mini must confirm the scheduling diagnosis through execution. No extra prewarming, sleeps, polling retries or timeout changes were added.
3. **Taste content failure.** `BridgedTaste` suspends on the content read; rejection reaches the shared section boundary before any rating selection. That boundary intentionally renders an assertive danger `InlineNotice` titled `This section could not be shown`, containing `Stored data was not replaced. The rest of Design keeps working.` and a `Try again` action. This differs from the old single fallback sentence. The test now asserts the alert and exact preservation message/action. All existing no-empty, no-ratings, no-synthetic-fallback, no-profile and zero-document-write assertions remain. The journal branch retains its separate typed Taste failure behavior.

## Changed paths

- `modules/design/app/compose/test/content-views.test.tsx`
- `modules/design/app/compose/test/core-recovery.test.tsx`
- `modules/design/app/compose/test/taste-view.test.tsx`
- `docs/handoffs/hq-life-20261103/b3/design-view-ci-repairs-20261112.md`

No conditional production grant was needed. No outside-cone hunk is requested. Isolated fake stores, per-workspace caches and content feeds remain intact. No new tests, inventory rows, dependencies or workflows were added; existing tests were strengthened in place, with no skips, deletions or relaxed assertions.

## Source checks and later executable owner

Source checks performed: source tracing of each failing path, literal-path and Git binding checks, final diff inspection and `git diff --check` (passed). No application/test code was imported or executed. No tests, typechecks, compilers, builds, installs, downloads of dependencies, services, native/browser launches, screenshots or lock operations ran. Syntax/AST validation was not run.

The existing Design inventory row `app` owns all three files via `compose/test/**/*.test.tsx`; it also owns full app Node discovery via `compose/test/*.test.ts`. No new row is necessary. One admitted Mini verifier owns all executable qualification at the integrated exact head with CI Node 24.19.0 / Python 3.13.5, required admission/controller and one serial test process. The slot assignment grants this builder no execution.

Exact later commands, from the verifier's bound repository root:

```text
node --test modules/design/app/compose/test/*.test.ts
node_modules/.bin/vitest run --config modules/design/app/vitest.config.ts
node tools/ci/local-checks.mjs --only foundation,design
```

The last command mirrors Foundation and the full required Design inventory/sections. Its Design app row already includes the first two commands, so the verifier can run the final command alone for the deduplicated full qualification, or use the first two for focused failure discrimination before the required full run. Preserve normal discovery, timeouts and failure reporting. Hosted inventory plus every emitted Design job and fan-in must be green on the integrated head; local execution does not supply hosted check evidence. The remaining required CLI/Planner family and all broader campaign acceptance duties stay with integration.

## Limitations and holds

Source completion is not behavior qualification. The three repairs await execution; no pass or timing claim is made. UI/native journeys, actual Runs entry, private Wiki, live posting, export/generation/component activation, signing, installation, deployment, main and all merges remain held. Recorded unselected findings are unchanged. Both historical delegate unknowns were supplied as reservation-rejected/no-remote-launch; neither request was retried. The coordinator owns PR #213 and integration; this branch creates no PR or watch.
