# Social references candidate

Authority effect: none. Source evidence for `task.social-references.001`, release
HQ-T10-012bc01. All exercised records are fictional core-fixture data.

## Binding

- Branch: `work/hq-social-references-20261020`, isolated worktree, one builder and Git owner.
- Base: `f31ec739a0a270a2fa2ac711e6c0272828c23ba3`.
- Base tree: `e0faea50e3a9859960640a763429a88c35050461`.
- Base parents: `e1f0748cc0c49c3a3e85e8c6a267bda921b283dd` and
  `012bc01df2ad6cced2ea6a09d2d1b9412e3f3021`.
- Plan blob: `8f124997cd0edac57e408038112cd2b5695c2d65`.
- Initial status was clean; the task branch was absent locally and on origin.
  Base existence was verified locally without fetching.
- `AGENTS.md`, `CLAUDE.md`, bootstrap and the pinned sections below were read.
  The local `.agents/shared-guidance.md` bridge was absent; shared enrollment
  through that bridge is unavailable. The host-adopted immutable guidance was
  read without installing anything.
- Parent retains lifecycle, integration, PR observation and merge custody.
  No descendants, model changes, service access or shared-state operations.

Sections were read at the base with `codex-v3-sections read ... --rev
f31ec739a0a270a2fa2ac711e6c0272828c23ba3 --in <document>`:

| Document | Section suffix | SHA-256 prefix |
| --- | --- | --- |
| `spec.hq-integration-parallel-execution` | `task.social-references.001` | `81161f6d8e3b` |
| same | `ctx.lane-t10.001` | `7e1bfe29b542` |
| same | `test.social-references.001` | `38c20408bbb3` |
| same | `ac.reference-lane-custody.001` | `b9379c9108fa` |
| same | `iface.shared-r3.001` | `a20a03d8ae7c` |
| same | `req.references-closure.001` | `0811c5a69d48` |
| same | `ac.reference-closure.001` | `0eb16a56fc29` |
| same | `ac.module-candidates.001` | `a9900995ece4` |
| `spec.hq-social-work` | `iface.references.001` | `0f66aadace17` |
| same | `req.references.001` | `f4ad3d78103e` |

## Implemented boundary

[`createSocialReferenceProvider`](../../../../modules/social/references/index.ts)
implements the frozen module-local `ReferenceProvider` using only injected
`snapshot` and `run` reads. It finds drafts, runs and brands in the bound project.
Resolution exposes all eight statuses and observation time. A run missing from
the newest-200 snapshot is checked through `run` before reporting it missing.
Brand/project mappings are used only when their existing capability is advertised.
Without mappings, the provider uses the explicitly bound fixed project context.

The content editor composes the landed `LinkPicker` and `LinkList`. It validates
serialized paste/drop through `parseReference`, rejects duplicate
domain/kind/entity identities, caps links at 30, checks project context, and
performs link/unlink/explicit snapshot updates and Undo through the existing
versioned draft save. Readback never rewrites snapshots. Shared chips show
observation time and freshness; stale observations do not become available.

Conflicts retain proposed links in the existing editor. Unknown outcomes retain
the proposal and require readback; text equality alone cannot confirm a link
save. A successful response that omits or changes submitted links is treated as
unknown, not persisted. Undo refuses to overwrite subsequent link changes.

`SocialModuleProps` and `SocialDomainProps` structurally extend `ModulePort` with
optional `references` and `returnContext`. The domain renders the return label
informationally; content calls the supplied `open(envelope, returnTo)`.
Without a reference port, the existing readable link snapshots remain.
No shared contract, shell, core, live-adapter, workbench or workspace-selection
source changed.

## Persistence gate

- **Flag present:** link mutations save the draft once with its current version.
  Undo is another versioned save, including normal conflict handling.
- **Flag absent:** link creation is disabled. Retained proposed links remain
  visible with the exact text **not saved — needs Social service support**.
  Saving a draft carrying those proposals is blocked before the workspace port;
  proposals survive remounts in the existing editor session. Nothing silently
  strips a nonempty proposal or claims it was saved. Even an empty `links` field
  is omitted from an unsupported content save.
- A different project is read-only, with no silent project navigation.
  No persistence schema or service was modified.

## Calls and fixture evidence

| Interaction | Calls at the module boundary | Execution calls |
| --- | --- | --- |
| Provider search | One `snapshot`; invalid/foreign scope returns without a call | 0 |
| Provider resolve | One `snapshot`; optionally one `run` for an older run | 0 |
| Link / valid drop | Resolve project context, one versioned `saveDraft`, then resolve displayed links | 0 |
| Unlink / explicit snapshot update / Undo | One versioned `saveDraft`, then resolve remaining displayed links | 0 |
| Unsupported save / invalid drop / rejected duplicate or limit | No `saveDraft` | 0 |
| Open | Supplied `ReferencePort.open` only; no Social execution or save | 0 |
| Drag an existing snapshot | No Social calls | 0 |
| Module remount / informational return context | May resolve displayed links; reuses the source editor session | 0 |

[`provider.test.ts`](../../../../modules/social/references/provider.test.ts) and
[`links.test.tsx`](../../../../modules/social/content/test/links.test.tsx) use
`createFixtureWorkspace` and `recordCalls`. They cover statuses, old-run lookup,
capability gating, versions, deduplication, limits, Undo, conflicts, unknown-save
reconciliation, explicit snapshot updates, project mismatch, open context and
retention across remount. The original Social registry round trip and workspace
selection suites also pass.

## Checks

Node `v24.19.0`. `npm ci` installed dependencies successfully, audited cleanly,
and left the lockfile unchanged. Every check was one serial process under the
shared HQ checks lock, preceded by the installed
`collect_work_capacity.py --format admission` collector. Host-specific paths
are intentionally excluded from this public evidence; the delivery report
retains the literal lock and collector invocations.

The named group's exact test patterns in `tests/check-groups.toml` are
`modules/social/references/**/*.test.ts`, `modules/social/references/**/*.test.tsx`,
`modules/social/content/**/*.test.ts`, and `modules/social/content/**/*.test.tsx`.
The focused command below discovers those same tests.

| Command | Result |
| --- | --- |
| `npx vitest run modules/social/references modules/social/content --maxWorkers=1` | 4 files, 57 tests pass |
| `npx vitest run modules/social --maxWorkers=1` | 18 files, 609 tests pass |
| `npm run typecheck` | Pass |
| `npm test -- --maxWorkers=1` | 66 files, 1,356 tests pass |
| `npm run build` | Pass; renderer and Electron compiled |
| `git diff --check` | Pass |

An earlier development run passed 53 tests and failed one new test that clicked
before the shared freshness clock enabled snapshot update. The test now waits
for the enabled control; the subsequent focused and broader suites pass.
Later checks also cover three additional persistence and mismatch cases.
The committed final candidate is rechecked before publication; the delivery
report binds those readbacks to its exact SHA.

Prepublication admission samples (all on 2026-10-20):

| Time | Next operation | Host CPU used | Available RAM |
| --- | --- | ---: | ---: |
| 08:22:42 EDT | `npm ci` | 7.01% | 43.86 GiB |
| 08:24:47 EDT | First focused check | 19.56% | 38.84 GiB |
| 08:25:59 EDT | Typecheck | 6.60% | 43.60 GiB |
| 08:27:10 EDT | Focused recheck | 18.93% | 43.56 GiB |
| 08:29:14 EDT | All Social tests | 10.31% | 43.51 GiB |
| 08:29:49 EDT | Full test suite | 13.25% | 43.86 GiB |
| 08:30:58 EDT | Build | 11.99% | 43.30 GiB |

All samples admitted one serial test process below 85% host CPU.
Effective capacity was 16 logical cores; one fully used core corresponds to
6.25% of host capacity (process CPU 100% means one core).

## Limitations and deferred integration

- Fixture and recorder tests prove the module source boundary only. They do
  not prove native rendering, live service persistence, shell registration,
  canonical r3 assignability or cross-domain reference round trips.
- Shell `App.tsx` open, return and Back remain the sole r3 writer's obligation.
  No return callback, cross-domain local navigation, synthetic return envelope,
  shared seam or shell edit was introduced. The remount test is not proof of
  product Back or integrated cross-domain restoration.
- Foundation landing waits for `r3-landing`. Hosted check qualification and
  parent integration remain separate from local passing checks and publication.
- Brands have no service revision or dedicated detail destination in the landed
  contract. Their provider destination is Overview; no revision is invented.
  The shared snapshot-update control requires a known latest revision.
- Retained unsupported proposals are session-local, as existing draft editors
  are; closing/discarding the editor or ending the app session is not persistence.
- No native capture was made and no preview server was started.
- The build reports a renderer chunk larger than 500 kB (881.47 kB). Build
  succeeds; shared bundling changes are outside this lane.
- No additional service, posting, scheduling, private-data or deployment work
  was performed. No stop condition was hit.
