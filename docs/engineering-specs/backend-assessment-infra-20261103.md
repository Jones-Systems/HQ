# Backend assessment — HQ build, test and CI infrastructure (2026-11-03)

Artifact Type: `engineering-spec` (assessment)

Artifact ID: `spec.hq-backend-infra-assessment-20261103`

Purpose: Baseline the build, test and CI health of `work/hq-foundation`, triage the in-flight storage, evidence and harness stacks, and name what stops the parallel lanes from verifying their work on the shared VPS.

Decision owner: M Jones

Consumers: HQ lanes B1–B5 and F1–F7; the integration owner

Authority effect: none

## Summary

- Foundation `0cd50ab` is healthy. Every required check passes in hosted CI, and every check except the storage suite passes locally on the shared VPS. Locally, a full typecheck and build takes 6.5 s and the root Vitest suite 15 s. The whole required set runs serially in about 3.5 minutes, most of it the Design sections (118 s).
- One host-specific defect blocks local verification. `tools/storage` assumes `umask 022`; this VPS uses `umask 0002`. Under it the storage tests fail (22 of 25) and then hang indefinitely. Worse, once #182 lands, `npm test` and `npm run build` refuse in every T3 worktree on this host. The fix is in progress (see [Plan](#plan)).
- Disk is the binding host resource. Only 59 GiB is free (97% used). #182's provisional policy requires 40 GiB free per receiving filesystem. Once the host drops below that, every admitted build and test refuses. Headroom is about 19 GiB, shared by all lanes.
- There was no shared way to launch the app and capture screenshots. Lane F7 built a working driver in `/tmp` that nothing else can reuse. A committed tool is in progress (see [Plan](#plan)).

## Environment

| Item | Observation |
| --- | --- |
| Host | 16 vCPU, 62 GiB RAM, no swap. During sampling: 26–35 GiB available, CPU 14–65% as about 12 lanes started |
| Storage | `/` is 2.0 TB with 59.3 GiB free (97% used). `/tmp` is a 32 GiB tmpfs (RAM-backed) with over 10,000 entries from many sessions |
| Toolchain | Node 26.13.0 locally (CI pins 24.19.0), npm 11.20.0, Python 3.13.5, TypeScript 7.0.2, Vite 8.3.4, Vitest 5.0.5 |
| Display and sandbox | Xvfb, `xvfb-run`, bubblewrap 0.12.0 and Chromium 156 are installed; unprivileged user namespaces are enabled |
| Electron | `npm ci --ignore-scripts` (the documented install) skips the binary download. `node node_modules/electron/install.js` fetches it (44.9.0, not in the shared download cache until first use) |
| Fonts | fontconfig resolves `sans-serif` and `system-ui` to Liberation Mono, so unstyled screenshots render monospace |
| umask | `0002` (user-private groups): new directories are 775 and files 664. T3 worktree parents are 775; the home directory is 700 |

## Required checks on foundation `0cd50ab`

All runs were local, serial and on this host, each after a fresh capacity sample.

| Check (CI job) | Command | Result | Wall |
| --- | --- | --- | --- |
| Install | `npm ci --ignore-scripts --no-audit --no-fund` | 162 packages, from cache | 3 s |
| Foundation: typecheck and build | `npm run build` | pass | 6.5 s |
| Foundation: Vitest | `node_modules/.bin/vitest run` | 117 files and 1,873 tests pass | 15.2 s |
| Foundation: Wiki | `npm test --workspace @hq/wiki` | 506 pass | 3.6 s |
| Foundation: portable acceptance | `node --test --test-concurrency=1 'tests/acceptance/**/*.test.mjs'` | 22 pass | 23.6 s |
| Foundation: storage lifecycle | `node --test --test-concurrency=1 'tools/storage/test/**/*.test.mjs'` | **22 of 25 fail, then hang** under `umask 0002`; 25/25 pass under `umask 022` | stopped after 10 min / 2.7 s |
| CLI and synthetic Planner E2E | `HQ_CLI_E2E=1 npm test` in `tools/hq-cli` | 85 pass, 0 skipped | 8.6 s |
| Planner Python | `python3 -m unittest discover -s tests -t tests` | 72 OK | 4.4 s |
| Planner Node | `node --test --test-concurrency=1 'tests/*.test.mjs'` | 29 pass | 1.1 s |
| Design sections (20 rows) | `tools/ci/design-sections.mjs run`, mirrored locally from the workflow inventory | 20/20 pass | 118 s |

Hosted CI on the open stack heads, all built on foundation `0cd50ab`, is green: Foundation 82–103 s, Design batch 86–106 s, CLI 28–33 s and Planner 24–30 s. Every job is well inside the 6-minute cap.

Slowest units, for later measurement (not blocking):

- Design `design-store` takes 26 s and `app-storage` 20 s, together 39% of Design time.
- The acceptance case `owned profiles and child processes disappear on success, failure and signals; peers survive` takes 14.7 s, 62% of the portable acceptance time.

## Findings

**I1 — P1, host: storage admission refuses every path on umask-0002 hosts.**
`resolveDestination()` rejects any non-sticky ancestor with `mode & 0o022`. `owned()` rejects any group-writable entry it measures. On this host, `resolveDestination(<any T3 worktree>)` fails with `Writable ancestor: ~/.t3/worktrees`; the primary checkout `~/Projects/HQ` fails the same way.

- **Today**, only the storage tests use the module.
- **After #182**, `npm test`, `npm run build`, `npm run build:electron`, `npm run build:preview-agent` and `npm run dev` (through `build:electron`) all refuse in every lane's worktree.
- **After the evidence stack (#176 → #178 → #180)**, the acceptance and preview runners refuse too.

Hosted runners use `umask 022`, so CI cannot catch this.

**I2 — P2, test reliability: a storage test hangs instead of failing.**
In `actual launcher process forwards SIGINT and cleans before its caller propagates the signal`, the readiness promise waits only for `message` or `error`. When the child dies first, the test waits forever. On CI that would consume the whole 6-minute job and report a timeout instead of the real failure.

**I3 — P2, host capacity: disk headroom against the storage policy.**
The policy reserves 30 GiB plus a 10 GiB peak, so it needs 40 GiB free on each receiving filesystem. The host has 59.3 GiB free.

Each lane adds roughly 185 MB of `node_modules`, about 3 MB of build output and, if it launches the app, about 250 MB of Electron binary. Lanes alone will not cross the line. Other projects on the same disk could, and then every admitted build refuses with `Storage refused: filesystem ...`. The refusal is by design; lowering the policy would need its own decision. Watch `df -h /`.

**I4 — P2, tooling: no shared way to see the running app.**
Several things combine:

- The sealed browser preview (`apps/desktop/preview`) refuses dirty worktrees and has no Design or Wiki.
- `npm run dev` needs a display and the Electron binary.
- The acceptance runner targets qualification evidence, not iteration.
- Host fonts fall back to monospace.

Lane F7 independently wrote an Electron, Xvfb and bubblewrap CDP driver in `/tmp`, which other lanes cannot reuse.

**I5 — P3, tooling: Design sections have no one-command local run.**
The 20-row inventory lives inside `.github/workflows/design-sections.yml`, so Design lanes cannot reproduce the Design job locally without re-deriving it.

## In-flight stacks

The review is in progress; verdicts and merge order will be added when it finishes. Every head below has green required checks against foundation `0cd50ab`, except #94 and #164, whose last runs predate the current foundation.

| PR | Purpose | Base | Head | Status |
| --- | --- | --- | --- | --- |
| #172 | Scoped Vite and Vitest caches inside each worktree | foundation | `e258cf3` | green |
| #177 | Design module caches inside each worktree | #172 | `b737d7b` | green |
| #182 | Admit root build and test commands through one storage envelope | #177 | `01b0aad` | green on CI; blocked on this host by I1 |
| #184 | Design harness caches in isolated namespaces | #182 | `3bf99ba` | green |
| #176 | Bounded standalone acceptance evidence writer | foundation | `f0b878c` | green; affected by I1 on this host |
| #178 | Bound acceptance runner evidence writes | #176 | `09c74a3` | green |
| #180 | Bound preview evidence streams | #178 | `85a49ae` | green |
| #94 | HQR-A9 harness cleanup and check groups | foundation | `f9648bb` | last run predates current foundation |
| #164 | Sealed browser preview on opt-in hosted CI | foundation | `e92c14f` | last run predates current foundation; hosted bubblewrap install awaits owner approval (PR comment, 2026-10-26) |

## Plan

1. Storage admission: tolerate group-write only below a private, user-owned Linux directory, keep every other refusal, and make the tests independent of the host's umask and unable to hang. This is a separate PR against foundation; it shares no files with the stacks except one untouched `tools/storage/README.md` paragraph. Land it before #182.
2. Shared dev-preview tooling: `tools/dev-preview/`, generalized from F7's driver. It provides seeded example, live and offline modes, one-command screenshots, an interactive control loop and `docs/dev-preview.md`.
3. Stack review: fix the issues found, bring #94 and #164 up to the current foundation, and propose a merge order.
4. Speed and flakes: measure the slowest units above, and fix the ones that block lanes.
