# T7 selected scenarios — implementation handoff

Authority effect: none. Source integration and installed-app acceptance remain separate from the scoped native evidence below.

Base: `3b5b636a672627f103334b2b7a0ea588e4bbf384`, branch
`work/hq-t7-scenarios`. Source scope is `tests/acceptance/**` and this acceptance
evidence directory. Root retains sole Git/index/commit/publication ownership.
Target integration is `work/hq-foundation`; the integration-owner merge hold
remains. No other PR was merged or cherry-picked.

Selected sources implement HQ-02/03 and HQ-09 through the existing dependency-free
CDP runner. HQ-07 implements independent catalog, preview-byte, generation and
last-good checks but reports held for the displayed-image edge. HQ-09H now adds the explicit distinct-host fixture/forward adapter and has native
evidence below. The root-provided baseline HQ-01 checkpoint remains preserved.

## Exact seams and remaining qualification

- HQ-07: `modules/design/app/compose/bridged-workspace.ts` supplies a throwing
  `thumbnails.readThumbnail` to the Projects controller. Real `catalog.preview`
  bytes are available, but the displayed thumbnail is not. Production ownership
  must resolve this edge; T7 does not write that file or add a new blob contract.
- Local selection is seeded only in the harness-owned profile using the existing
  persisted catalog schema. Native chooser behavior is untested.
- HQ-09H is qualified only for the synthetic distinct-host HTTP/SSH workflow
  described below; unbound invocations keep its row held. No TLS, provider,
  filesystem transport or live-preview claim follows.
- `.agents/shared-guidance.md` is absent; local shared enrollment unavailable.
  No activation was performed. HQ's partial UI map and Work entry were read;
  local Frontend-Development layout guidance was read. Its linked UI-view-map
  guide was absent from the available local HEAD and origin/main snapshots.
- Settings source forms, Work capture/recovery and the interactive source
  selector have scoped native evidence; no broader entry-point coverage is implied. Preview launching, dialogs, Wiki transport,
  provider/auth, private data and live services are excluded.

## Original source-only handoff commands

The original builder lane was source-only. The later HQ-09H assignment explicitly
authorized one serial app/test slot and the synthetic cross-host fixture/relay.
Take fresh same-host capacity admission before each runtime command. Use the pinned dependency/runtime install already
bound by the root; no root manifests, locks or CI files changed.

```sh
node --test --test-concurrency=1 tests/acceptance/fixtures/fixtures.test.mjs tests/acceptance/fixtures/scenarios.test.mjs tests/acceptance/cleanup.test.mjs
npm run build
node tests/acceptance/run.mjs --checkpoint
node tests/acceptance/run.mjs --selected
node tests/acceptance/run.mjs
```

The selected run is expected to stay nonzero while HQ-07's rendered-image edge is
held. The full run additionally retains all unimplemented reserved rows. Neither
is a passing acceptance command merely because the implemented assertions pass.
Retain first-attempt failure reports; diagnose before any new run. Root owns
Linux qualification, repeatability/resource measurements, exact commit binding,
review and delivery. Historical checked-in result JSON was not rewritten.

## Original builder verification

Source-only checks: `node --check` on the eleven changed/new `.mjs` modules and
`git diff --check`. Both passed. No test assertions, server processes, build,
native Electron runs, remote host operations or Git/index mutations were run.
The fixture tests are authored, not passing evidence. All changed paths remain
inside the two assigned source cones.


## HQ-09H implementation and native qualification — 2026-10-22

The implementation sub-agent edited only this note and `tests/acceptance/**`.
Root remained sole Git owner; no staging, commits, publication or production edits
were performed. Existing pending source changes and the Work readiness fix
`3588f3c1cfb199e8cc82ca8948b4ccb3d4b8beeb34b1bb3236d6189698461c53`
were preserved. The built app was reused: Electron 44.9.0, app-host Node 24.22.1,
fixture-host Node 24.19.0, same base HEAD as above. No build/test/app ran on the
laptop; the fixture host ran only the small synthetic HTTP/control process.

New files are `fixtures/host-gallery.mjs`, `fixtures/host-gallery.test.mjs`,
and `qualify-host-gallery.py`. The existing `run.mjs`, source scenario,
result aggregation, focused fixture tests and README bind the new workflow.
The fixture reuses `remote-gallery.mjs` without changing its bytes. The native
harness rejects same-host binding, checks the remote identity on every control
response, and compares remote disk hashes against its deterministic corpus.
The test host lacked the fixture host's SSH alias; the explicitly authorized
laptop relay used local forwards to the fixture and reverse loopback forwards
to the test host. No credential copying or host configuration change occurred.

The four final `--gallery-only --gallery-host` runs all passed the H row and shell
prerequisites, with cleanup passed and zero remaining harness children. Each
reused the same built app and created a fresh native profile. This is the assigned
initial run plus three warm repetitions, not the campaign's larger cold/five-warm
portfolio. Reports are under the app worktree's `.t3/acceptance-evidence/`:

| Report directory | H case elapsed | Total including cleanup | CPU used / available RAM | H / cleanup |
| --- | ---: | ---: | --- | --- |
| `run-bC8xsW` | 4.824 s | 6.981 s | 0.62% / 59.16 GiB | PASS / PASS |
| `run-sH62WS` | 4.791 s | 7.045 s | 0.31% / 59.11 GiB | PASS / PASS |
| `run-AkZ5Sd` | 4.805 s | 6.949 s | 0.00% / 59.09 GiB | PASS / PASS |
| `run-4ZhUPo` | 4.790 s | 6.988 s | 0.31% / 59.11 GiB | PASS / PASS |

Each admission used 16 effective cores, one fully used core = 6.25%, and allowed
one serial process. The H assertions establish real UI enrollment, exactly three
remote metadata GETs with matching wire/disk digests, persisted identity/snapshot
across a real Electron restart without a fetch, bad-digest/malformed/disconnect
last-good retention, inactive enrollment after UI removal with remote files
unchanged, and restoration/restart absence without a fetch. Removal correctly
retains HQ's inactive registry tombstone. The final fixture ledger contains 32
requests (eight per run), including four actual disconnected responses, and all
four corpus file digests remain unchanged.

The final screenshots in each report directory include
`gallery-host-enrolled-settings.png`, `gallery-host-last-good-stale.png`,
`gallery-host-removed.png` and `gallery-host-removed-after-restart.png`.
Enrolled, stale and removed states were visually inspected; the removed-state
capture now waits for paint after scrolling the section into view.

External evidence is retained in the owner-bound `hq-distinct-host-01` directory
on both authorized hosts. `attempt-06/evidence/relay-report.json` contains host
identities, origins, transferred source hashes, every admission and native result,
PID/PGID ownership and exact cleanup. The fixture host also retains
`attempt-06/evidence/host-process.json` with its ledger and final disk hashes.
Both exact `attempt-06/work` trees are absent. Fixture PID/PGID 4083936,
fixture-side SSH helper 4083965, app-side helper 2485203, and local SSH groups
39140/39141/39143 are closed. Native reports separately prove profile/app/display
cleanup. Evidence directories intentionally remain.

First-attempt failures remain failures: the initial launcher called `setsid()`
from an existing session leader and failed before HTTP/native startup. The launcher
now retains an existing owned session. `attempt-02` / `run-EEIc75` then failed the
harness's incorrect physical-registry-deletion assertion; production source proves
removal sets `active: false`. That assertion was corrected, without timeout or
retry changes. Both attempts cleaned their owned work. Attempts 03 and 04 passed
four runs each; screenshot inspection led to paint synchronization and the final
attempt 06. Earlier results and images remain historical, not overwritten.

A deliberate SIGTERM during a live native process is preserved in
`attempt-05-cancel/evidence/relay-report.json` and native `run-UcXyiW`.
It remains cancelled/nonzero, with native cleanup passed. Native PID 2484857,
fixture PID/PGID 4082118, remote helpers 4082175/2484822 and local SSH groups
34643/34644/34646 all closed; both exact work trees are absent. This directly
exercises relay cancellation as well as the focused success/failure/signal tests.

The complete focused fixture/cleanup group passed 15/15, no skips, in 23.064 s;
its log is `.t3/acceptance-evidence/host-fixture-check-01.log`. Admission was
0.00% CPU, 16 cores, 59.18 GiB available RAM, one serial process. The added three
host lifecycle cases cover success, deliberate failure and SIGTERM, preserving
remote ledger/digests, removing exact scratch and retaining a peer listener.

Final native source SHA-256 bindings (paths relative to `tests/acceptance`):

- `run.mjs`: `aa170eb3aa37d93605c83b7b97aec789f1323c77287382ad863c9838e0ee5a8d`
- `scenarios/sources.mjs`: `97f1868e8069b67977984f85dbb1620a6da7ac1a43599e36d4d27bf446a61353`
- `fixtures/host-gallery.mjs`: `8ba8e3d13791683ee5337ba4b2d4e92ce8953c720e4dadff0fd50578e3f814f9`

Built entries remained `d880a62ad09924bdd3b33fd61a7b37c3d7a132b78881e0c8b311b52e7033662b`
(index), `681808f54af27bbffecf71f7c41b7e912af82e4a233ab709b19a909343bbdebf`
(main), and `255c57f477595fa88c7a8fb98a84aa1da6c7dfe8c6651a3ffe1c161756c1cf38`
(preload). Every report includes the complete harness binding.

Preserved baseline evidence: HQ-01 `run-ltYKAI`; HQ-02/03 and same-host HQ-09
`run-rbSQSK`. HQ-07 remains held for production T2's throwing thumbnail adapter;
native chooser remains unproved. Outside-selected rows stay gaps. The selected
command therefore remains nonzero; H-only success is not blanket acceptance.
Root's next step is its independent integrated-candidate exercise, exact candidate
binding, review and delivery under the unchanged integration-owner merge hold.


Final regression readback: `run-S3ttT1/report.json` ran `--selected` on the same
candidate in 7.788 s. HQ-02, HQ-03, same-host HQ-09 and shell checks passed;
HQ-07 remained held, unbound HQ-09H remained held, reserved rows remained gaps,
and exit 1 / `platform-or-integration-gap` was expected. Cleanup passed with zero
remaining children. Its fresh admission was 34.28% CPU / 58.26 GiB available RAM,
16 cores (6.25% per core), one serial start. The additional selected/H result-gate
assertion passed 1/1 in 0.130 s at 31.46% CPU / 58.29 GiB. Relay Python syntax and
`git diff --check` passed. Complete final source hashes and mirrored-file readback
are retained in `attempt-06/evidence/source-bindings-final.json`.
