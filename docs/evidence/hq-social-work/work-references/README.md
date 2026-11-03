# Work reference source evidence

The final section records the single normalization onto landed shared r3. Earlier sections retain the original source-candidate evidence; their statements about waiting for r3 describe that earlier qualification.

This candidate implements `spec.hq-integration-parallel-execution#task.work-references.001`, step 1 of `ctx.lane-t11.001`, from foundation `f31ec739a0a270a2fa2ac711e6c0272828c23ba3`. All records, titles, projects and services used here are **synthetic**.

Source acceptance is bounded to the module source boundary. Integration and native qualification stay held. Source fixture/recorder checks do **not** prove native or live persistence, foundation landing, shell provider registration, canonical assignability or the integrated reference round trip. Those wait for actual r3. Cross-domain Back is shell/r3-owned per T1's disposition: this module only accepts and renders informational `ReturnContext`, and passes the source context to `ReferencePort.open`. It neither fabricates a return envelope nor uses local navigation for cross-domain Back. The full product Back obligation remains with shell integration.

## Implementation and coverage

- `createWorkReferenceProvider(projectId, reader, now?)` retains only a snapshot reader. Its module-local `ReferenceProvider` matches the frozen canonical interface. It finds Work items in the bound context, including archived items, and resolves revision changes, archives, missing items, unknown kinds/projects and unavailable reads without writes or execution.
- The optional `references` and `returnContext` props structurally extend `ModulePort`. The public Planner injection seam is unchanged. No shared contract, live/core runtime, other domain or export UI changes are included.
- The card Links section uses the landed UI kit's picker, list, eight statuses, observation time and freshness checks. Unresolved/stale availability stays unknown. Project mismatches are read-only. Snapshot updates are explicit.
- Creation, unlink and snapshot update use the existing Planner revision guards, detail conflicts and Undo. A stale rendered reference base is checked before dispatch. Pending and unknown writes keep their existing recovery path and disable new reference writes. The persistence capability is required; duplicate targets and the shared 30-link limit are enforced. Paste/drop use unchanged `parseReference`.
- The recorder tests exercise search, link, unlink, snapshot update, open, informational return mounting and dragging a linked card. The only observed Planner writes are planning patches/moves. There is no execution port in either provider or reference interface. Shell return execution is not simulated or claimed here.
- The synthetic export/import test serializes fixture records and imports them into a new fixture Planner, comparing envelope UTF-8 bytes and complete record JSON. It is explicitly **not** a Planner transport/export implementation, new product export format, or native persistence claim. RW-6 UI and transport remain held.

## Reproduction and checks

Node `v24.19.0`; `npm ci --no-audit --no-fund` completed (150 packages). The existing root lockfile was unchanged.

Before each test/build, the task ran the supplied `collect_work_capacity.py --format admission` from the telemetry skill directory. All samples admitted one serial check process (CPU below 85%). One fully used logical core is 6.25% of the sampled 16-core host capacity. Every check ran under `flock "$HQ_CHECK_LOCK"`, using the coordinator's supplied shared lock path; no concurrent check invocations were started by this task.

The affected catalog globs are:

```text
modules/work/references/**/*.test.ts
modules/work/references/**/*.test.tsx
modules/work/detail/**/*.test.ts
modules/work/detail/**/*.test.tsx
modules/work/export/**/*.test.ts
modules/work/export/**/*.test.tsx
```

They were expanded from `tests/check-groups.toml`, deduplicated and passed as filenames:

```sh
flock "$HQ_CHECK_LOCK" python3 -c 'import glob, subprocess, tomllib; g=tomllib.load(open("tests/check-groups.toml","rb"))["groups"]["hq-work-references"]; paths=sorted({p for pattern in g["tests"] for p in glob.glob(pattern,recursive=True)}); print("Expanded tests:", *paths, sep="\n", flush=True); raise SystemExit(subprocess.call(["npx","vitest","run","--maxWorkers=1",*paths]))'
```

Expansion: `modules/work/detail/test/detail.test.tsx`, `modules/work/references/test/links.test.tsx`, `modules/work/references/test/provider.test.ts`, `modules/work/references/test/roundtrip.test.ts`. No export tests exist in this source-only candidate.

| Check | CPU used | Available RAM | Result |
| --- | ---: | ---: | --- |
| Dependency installation | 26.02% | 38.93 GiB | Passed |
| First affected run (same command without `--maxWorkers=1`) | 21.00% | 43.61 GiB | 34 passed, 6 failed; new synthetic IDs and picker locator corrected |
| Initial `npm run typecheck` | 9.94% | 43.15 GiB | Passed |
| Final affected run | 12.46% | 43.27 GiB | 40 passed, 0 failed; 4 files |
| Preview `npx vite build --config modules/work/references/preview/vite.config.ts` | 16.41% | 43.42 GiB | Passed; 66 modules |
| Final `npm run typecheck` | 2.80% | 43.50 GiB | Passed |
| Final `npm test -- --maxWorkers=1` | 24.76% | 43.28 GiB | 1,364 passed, 0 failed; 67 files |
| Final `npm run build` | 20.75% | 43.64 GiB | Passed: typecheck, 390-module renderer build and Electron compilation |

Root commands (each run separately after fresh admission):

```sh
flock "$HQ_CHECK_LOCK" npm run typecheck
flock "$HQ_CHECK_LOCK" npm test -- --maxWorkers=1
flock "$HQ_CHECK_LOCK" npm run build
```

`git diff --check` passed. Source files and preview output SHA-256 values are recorded in [source-manifest.json](source-manifest.json); this binds the tested source contents to the candidate without a self-referential commit hash. The foundation comparison is recorded there. Documentation/capture additions do not change the checked source.

## Browser evidence

The Jones Code collaborative browser loaded the static synthetic preview at its environment port, using the app's existing restrictive CSP. Viewport: 1280 × 800 CSS pixels, device pixel ratio 2, default light theme. The build was produced with:

```sh
flock "$HQ_CHECK_LOCK" npx vite build --config modules/work/references/preview/vite.config.ts
npx vite preview --config modules/work/references/preview/vite.config.ts
```

The browser fetched the exact hashed JS/CSS filenames listed in the source manifest. The preview was stopped after verification. No external service was connected.

1. The initial link showed **Changed**, revision 0, latest target title, a fresh observation and an unchanged snapshot.
2. **Update snapshot** changed the source snapshot to “Learn three bread recipes”, revision 1, then resolved as Available. [Capture](snapshot-updated.png).
3. **Undo** restored “Earlier snapshot title”, revision 0, resolving as Changed. [Capture](snapshot-undone.png).
4. **Open** changed the synthetic recorder to `ex-bread`. It did not perform shell navigation or execution. Automated tests separately assert the source return context passed to the port.

These are action-before/after checks on one source build, not native screenshots or a comparison against a separately built baseline. The DOM tests verify fixture stored-record readback; no live persistence or cross-domain round-trip claim is made.

## Remaining integration obligations

The integration owner must supply actual r3, register the provider, prove canonical assignability and shell open/return/Back state restoration, then perform native qualification. RW-6 export UI/transport remains outside this candidate. Hosted checks and foundation landing are separate from these local source checks; the parent owns their observation and integration. No merge, deployment or installation is included.

## Single normalization onto landed shared r3

T1 accepted original source head `7f7b21ed37d2d87c35feb3662c837cfb32a01fb8` (tree `62a9722a27a16f062f241ec4fd8cc2f3ffee8009`). Its branch and origin ref matched and the worktree was clean before normalization. Shared r3 then landed at `fb08c4c607dad4ae954126fbf8ae6ed14565da05`, which is the sole cause for this bounded merge.

Only the named immutable object was fetched with `git fetch --no-write-fetch-head --no-tags origin fb08c4c607dad4ae954126fbf8ae6ed14565da05`; no tracking ref or FETCH_HEAD was updated. Its verified tree is `e9d22303524b1ba17d91c9842ea5def21278bf98`, with parents `43a742b96cf484fe5453d798ca8177bf9b91230a` and `56b70b8f54360ec0dcfb53b13858070094ff9255`. The original foundation `f31ec739a0a270a2fa2ac711e6c0272828c23ba3` is its ancestor.

The ordinary no-ff merge completed without conflicts:

- Merge: `28a89e7d206bb63d342e0f0a2c3ade67e055ea81`.
- Tree: `fbc6ebb9a63db4ec37baa60506ebf1d406d36c62`.
- Parents, in order: `7f7b21ed37d2d87c35feb3662c837cfb32a01fb8`, `fb08c4c607dad4ae954126fbf8ae6ed14565da05`.
- The entire authored cone at the merge is byte-identical to the accepted source head: the cone diff is empty.
- Everything outside the cone is byte-identical to landed r3: the complementary diff is empty.
- Root `package.json` and `package-lock.json` are unchanged. The imported contracts manifest adds exports only. Dependencies did not change, so `npm ci` was not run.
- No production or test files were edited during normalization. This evidence-only follow-up is separate from the merge.

Qualification ran exactly once as one serial sequence inside one `flock "$HQ_CHECK_LOCK" bash` invocation. Before any check, and while holding that lock, `python3 scripts/collect_work_capacity.py --format admission` ran from the supplied telemetry skill directory. Admission: CPU **10.03%**, available RAM **42.94 GiB**, effective capacity **16 logical cores**, one fully used core **6.25%** of host capacity; status `ok`. CPU was below 85% and one serial process was admitted.

The batch used `set -e`, validated the telemetry JSON, then expanded the exact catalog groups `hq-work-references` and `hq-work-runtime` into one sorted, deduplicated list. The runtime group globs are `modules/work/**/*.test.ts` and `modules/work/**/*.test.tsx`; the reference globs are listed above. Exact union command:

```python
import glob, subprocess, tomllib
with open('tests/check-groups.toml','rb') as f:
    groups=tomllib.load(f)['groups']
names=['hq-work-references','hq-work-runtime']
paths=sorted({p for name in names for pattern in groups[name]['tests'] for p in glob.glob(pattern,recursive=True)})
assert paths
print('Deduplicated union: '+str(len(paths))+' files', flush=True)
print('\n'.join(paths), flush=True)
raise SystemExit(subprocess.call(['npx','vitest','run','--maxWorkers=1',*paths]))
```

The remaining commands ran sequentially under the same held lock:

```sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
git diff --check 7f7b21ed37d2d87c35feb3662c837cfb32a01fb8..HEAD
```

Results: union **610 passed, 0 failed, 32 files**; root typecheck passed; root suite **1,387 passed, 0 failed, 73 files**; production build passed (393 renderer modules and Electron compilation); merge-range whitespace check passed. Vite emitted a non-fatal warning for a minified chunk over 500 kB. No stress loops, retries or semantic repairs were performed.

The earlier browser screenshots and manifest remain evidence for the original source build; they were not recaptured or represented as browser qualification of the normalized build. All fixtures remain synthetic. Provider registration, integrated round trip, native/live persistence and Work export UI remain held for their later tasks. Cross-domain Back remains shell/r3-owned. This normalization makes no architecture amendment or canonical type change.
