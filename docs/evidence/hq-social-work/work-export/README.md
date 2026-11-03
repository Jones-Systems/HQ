# Work export source acceptance

Task: `task.work-export-ui.001`, release `HQ-T11-012bc01`.
Base: `7e3d40c1a68d2586af980f40febca477bd7adfcd` (tree `d3442194d9b3f419517aea5967ecfab665fbda59`).
Checked source: `2db32ffe80abfec28d1b549211707ec031815509` (tree `144ba2300ff92c52b14f473418c978ae25b324a9`).

## Binding and authority

The worktree was clean on the retained references branch at `fc6016824eb3e8e35e7fe3fe572c9f6ff2c24b21`. The new export branch was absent locally and remotely; no open PR overlapped its head or export/nav paths. The exact immutable-object fetch succeeded:

```sh
git fetch --no-write-fetch-head --no-tags origin 7e3d40c1a68d2586af980f40febca477bd7adfcd
```

The fetched commit has parents `c967d2c9ea1a0cdc02010db0f63b745dc1f16301` and `fc6016824eb3e8e35e7fe3fe572c9f6ff2c24b21`; origin foundation matched it. Branch `work/hq-work-export-ui-20261020` was created there with `--no-track`. The retained references branch remains unchanged.

Plan blob `8f124997cd0edac57e408038112cd2b5695c2d65` matched. SHA-256 prefixes over the exact marker interiors:

| Block | Digest |
| --- | --- |
| task.work-export-ui.001 | fa4d8b0b0d3b |
| test.work-export-ui.001 | f429aa4fdae6 |
| req.work-export.001 | 4b26953cd820 |
| ctx.lane-t11.001 | cc3c34e6084b |
| iface.shared-r3.001 | a20a03d8ae7c |

## Source behavior

Settings exposes explicit Export JSON and Export Markdown buttons through optional `WorkDomainProps.workExport`. Missing injection disables both buttons with an explanation. The UI reports pending, Planner status, saved, cancellation, non-2xx failure, unavailable and unknown outcomes. It suppresses duplicate pending clicks and does not attribute a late result to a replacement port. Import and replace-restore remain explanatory pointers to the Planner's own tools.

The local structural response avoids a new production dependency outside Work's existing import boundary. `port.test.ts` proves exact method-type equality with canonical `ServiceResponse<{ saved: boolean }>` and `WorkServiceParams['export']['format']`; a read-only assertion checks the landed client's explicit declaration. It imports no application code. Renderer state retains only status and closed outcome, never destination paths, exported bytes or raw exceptions. No renderer formatter, production fake or live fallback was added.

All fixtures and captures are **synthetic**. Tests cover both explicit formats; no export on mount/navigation/reference destination opening; zero Planner writes or execution; pending duplicate prevention; saved/cancelled/error/unavailable/unknown; response-data suppression; absent-port gating; malformed results; replacement-port attribution; structural compatibility.

## Qualification

Package and lockfile are unchanged from the installed prior candidate (`git diff --name-only fc6016824eb3e8e35e7fe3fe572c9f6ff2c24b21 HEAD -- package.json package-lock.json` returned empty); no dependency installation was needed.

The final batch used one lock for the entire serial sequence. `$HQ_CHECK_LOCK` denotes the assigned shared checks lock; `$HQ_TELEMETRY_SKILL` denotes the assigned telemetry skill directory. These variables substitute host-local paths only; no paths or private host data are published here.

```sh
flock "$HQ_CHECK_LOCK" bash -c '
set -euo pipefail
(cd "$HQ_TELEMETRY_SKILL" && python3 scripts/collect_work_capacity.py --format admission)
python3 - <<'"'"'PY'"'"'
import glob, subprocess, tomllib
with open("tests/check-groups.toml", "rb") as source:
    groups = tomllib.load(source)["groups"]
files = sorted({path for group in ("hq-work-references", "hq-work-runtime") for pattern in groups[group]["tests"] for path in glob.glob(pattern, recursive=True)})
assert files
print("Deduplicated affected files:", len(files), flush=True)
subprocess.run(["npx", "vitest", "run", "--maxWorkers=1", *files], check=True)
PY
npm run typecheck
npm test -- --maxWorkers=1
npm run build
git diff --check 7e3d40c1a68d2586af980f40febca477bd7adfcd..HEAD
'
```

Telemetry inside the lock: CPU **15.82%** (<85%), **42.20 GiB** RAM available, effective capacity 16 cores, one full core 6.25%, normalized one-minute load 0.2669, steal 0%, CPU PSI some avg10 0.69%. Admission allowed one serial test process. The measured CPU admitted the batch.

Final results (all exit 0):

| Check | Result |
| --- | --- |
| Deduplicated affected union | 34 files passed, 624 tests passed, 0 failed |
| Root typecheck | Passed, 0 errors |
| Root tests | 77 files passed, 1416 tests passed, 0 failed |
| Root build | Passed; 398 renderer modules; Electron compilation passed |
| Merge-base-to-source whitespace check | Passed, 0 errors |

Vite reported a non-failing chunk-size warning for the main bundle (890.84 kB minified, 269.05 kB gzip). No production or test changes followed this qualification; the final follow-up commit adds evidence only.

## Development and visual evidence

Before final qualification, focused export tests passed **14/14** in **2/2 files**, with CPU 9.38% and 41.73 GiB available RAM. Command: `flock "$HQ_CHECK_LOCK" npx vitest run --maxWorkers=1 modules/work/export/test/port.test.ts modules/work/export/test/export.test.tsx`.

A separate serial development batch, under the lock with telemetry first, passed `npm run typecheck` and `npx vite build --config modules/work/export/test/preview/vite.config.ts` (41 modules). CPU was 8.75%, RAM available 43.24 GiB. The preview was served with `npx vite preview --config modules/work/export/test/preview/vite.config.ts` and stopped after capture.

The collaborative browser verified initial zero calls and idle state, an explicit JSON save, and an explicit Markdown non-2xx response in dark mode. One initial outcome-selector attempt timed out because its label was incomplete; the current snapshot provided the exact label and the corrected interaction succeeded. No application console errors were observed. `captures.json` binds synthetic screenshots to source hashes, preview asset names, viewport and scale. These are component-fixture captures, not the full native application. The fixture inherits a browser font rather than the full Work shell's typography.

- [Light: saved, status 200](light-saved.png)
- [Dark: failure, status 503](dark-error.png)
- [Capture manifest](captures.json)

## Acceptance boundary and deferred qualification

Source acceptance is bounded to the module source boundary. Actual client injection by T2, round trip and native qualification remain later tasks. Provider registration, native/live persistence and integrated save-dialog/filesystem behavior are not proved by these source fixtures. Integration and native qualification stay held. Cross-domain Back remains shell/r3-owned. No import or replace-restore implementation, canonical type change, application wiring or index change is included.
