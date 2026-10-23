# HQD-F2 work note

Owner and sole Git owner: HQD-F2. Branch: `work/hq-design-compose-bridge`.
Base: `2886846745f08ff3a28e878d218902a10eba9234`.
Write scope: `modules/design/app/compose/**` and `modules/design/app/index.ts`.
No changes to F1, contracts, manifests, lockfile, workflows or section implementations.
No publication, integration, deployment or installation claim.

## Candidate

The engineering spec in this directory records the settled boundary and selection design.
The original fake composition was moved without behavior changes to fake-workspace.ts; workspace.ts
selects it or the F1-backed composition. The shell's export names and declared types are preserved.
No subagents, other-thread messages or external publication were used.

## Check evidence and remaining gate

All executed tests were serial and protected by the shared checks lock. Admission sampled aggregate
CPU over two seconds, load averages, processor count and MemAvailable before each batch.
All samples reported 16 logical processors.

| Batch | CPU used % | MemAvailable GiB | Load 1/5/15 | Outcome |
| --- | ---: | ---: | --- | --- |
| Initial install admission | 27.65 | 40.68 | 9.05/6.97/6.10 | Nonblocking lock refusal, exit 200; npm never ran |
| Bridge and renderer tests | 17.12 | 40.41 | 8.74/7.68/6.46 | Exit 0; 50 passed, zero failed/skipped |
| Install and app check | 15.75 | 40.27 | 5.20/6.83/6.26 | npm ci succeeded; app typecheck exited 1 with two errors |
| Corrected app/compose | 26.89 | 39.19 | 4.01/6.16/6.06 | App typecheck exit 0; 144 tests passed, zero failed/skipped |
| Final union attempt 1 | 28.36 | 38.56 | 6.58/6.28/6.10 | 45-second lock wait timed out, exit 200; no check ran |
| Final union attempt 2 | 84.34 | 38.50 | 11.06/7.64/6.59 | 45-second lock wait timed out, exit 200; no check ran |

The initial typecheck found a missing empty-catalog listViews member and an unreachable bridged
branch in the fake Flow view. Both were fixed before the successful app/compose check.

After that check, final review tightened JSON and malformed-list validation, added corresponding
malformed-value cases, preserved the type-only graph restrictions outside storage internals, and
updated comments. These final edits have NOT been typechecked or tested: both final union waits
timed out. The owner authorized two bounded attempts; that allowance is exhausted.

Pending final-candidate commands: workflow inventory guard; app/storage typechecks; all compose/storage
node tests; npm run typecheck; npm test; npm run build. New test files match the existing
compose/test/*.test.ts inventory row, but the exact inventory guard has not yet run.
The extracted guard and serial check script are retained with append-only private check logs.

npm ci installed 149 packages and audited 155, reporting zero vulnerabilities. Manifests and lockfile
are byte-unchanged. git diff --check passes. Optional production preview was not run; no server
was started. Shared-guidance enrollment is unavailable because the local bridge file is absent.
Lock contention is known-no-effect, not a safety denial or unknown mutation. No safety denial or
unknown effect occurred. This is a source candidate awaiting required final checks, not ready integration.
