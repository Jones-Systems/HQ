# T7 harness checkpoint

Plan: [`f2a81c4`, task.acceptance-harness.001](https://github.com/Jones-Systems/HQ/blob/f2a81c4f1a0ab14c89cec5764b42891059630f5e/docs/engineering-specs/hq-integration-parallel-execution.md).
Application source: the same commit, including mounted joint shell C and merged
CLI/Planner. T7 owns only `tests/acceptance/` and this evidence directory.

Implemented an HQ-specific, dependency-free native CDP harness with real Electron,
Xvfb and bubblewrap, private profile/temp storage, screenshots, graceful restart
and exact owned-process/scratch cleanup. No production, root package, dependency,
Design test or interface changes. No descendants or independent reviewers.

Observed on this baseline:

- `npm ci`: passed; Electron required its explicit package installer afterwards.
- `npm run build`: passed (includes typecheck); existing chunk-size warning retained.
- Native shell checkpoint: passed Design/Social/Work round trip and real process
  restart restoring Work and dark appearance. Preload, isolated renderer globals
  and CSP presence assertions passed. Cleanup passed.
- Cleanup self-test: passed success, deliberate failure (original exit 7 preserved),
  SIGINT, SIGTERM, and isolation from another concurrent profile/process.
- CPU admission was sampled before each run, below the 85% start threshold;
  one serial process at a time, 16 logical cores (one fully used core = 6.25% host).

The initial runner iteration lacked Electron's binary; the next exposed a missing
private `/dev` mount. Both were corrected within the harness/dependency setup.
Abrupt termination did not flush the profile; the checkpoint now requests normal
Electron shutdown before restart. These failed attempts are not product passes.

## Held acceptance

The pinned app has no Wiki domain or integrated live settings/service path. Full
mode fails closed. Synthetic service replay, reference round trips and truthful
unavailable/unknown UI assertions are not implemented or passed. T1 must supply
that integrated source binding before this scenario work can complete; the request
is in [coordination issue #50](https://github.com/Jones-Systems/HQ/issues/50#issuecomment-6286286294).

Root test/CLI/Planner unions and final acceptance are not assigned to this harness
checkpoint and were not run. Install-route research is separately assigned. No
laptop installation, signing, deployment, privileged operation or private-data
inspection occurred. Source publication and T1 landing remain separate outcomes.
