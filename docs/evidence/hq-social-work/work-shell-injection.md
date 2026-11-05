# Work shell injection evidence

Artifact Type: evidence
Artifact ID: evidence.work-shell-injection
Purpose: Record the public Work injection seam and bounded implementation checks.
Authority effect: none

The public `@hq/work` entry exports `setWorkSessionPort` and `examplePlanner`.
The setter implementation and signature are unchanged. The shell calls it once
before the first session, supplying a configured live port and recovery with
`example: false`, or the labelled example with `example: true` only when settings
are explicitly unconfigured. Configuration changes use the existing labelled
reload. This patch does not implement shell wiring or enforce a new setter guard.
Existing sessions survive remounts; live errors do not select fixtures.
`resetWorkSessions` remains internal test support and is not a package export.

Both changed docstrings have disposition **keep near code**: the entry corrects
the obsolete claim that no Planner service is reachable, and the setter documents
the shell's ordering, source-selection and recovery obligations.

## Reproduction and checks

Production preimage: `9badd4f16b55e14a52e91cff95f6a5d6f20ec584`.
Environment: Node `v24.19.0`, npm `11.17.0`, Vitest `5.0.5`, happy-dom.
All Planner inputs and transport responses are synthetic; no live endpoint was used.

`npm ci --no-audit --no-fund` succeeded without changing the lockfile.

With the new tests and unchanged production preimage,
`npx vitest run modules/work/nav/test/live-selection.test.tsx` reported five failures
and seven passes. The public-export test observed `undefined` instead of the setter;
the injection tests failed because the public functions were absent.
After the export change, the same public-export test passed without changing its
content. One separate new remount assertion initially counted recovery reads too;
it was corrected to compare reads immediately across remount. The whole original
test file is therefore not claimed as unchanged red/green evidence.

Final checks:

| Invocation | Result |
| --- | --- |
| `npx vitest run modules/work/nav/test/live-selection.test.tsx` | 12 passed |
| `npx vitest run modules/work` | 587 passed, 29 files |
| `npm run build` | Three TypeScript checks, Vite production build and Electron build passed |
| `npx vitest run apps/desktop packages/contracts` | 79 passed, 9 files |
| `git diff --check` | Passed |

Affected groups: `hq-work-runtime` and `hq-root-build`, from
`tests/check-groups.toml`, schema `codex.v3-check-groups/v1`, SHA-256
`ca89a5730d0c6b6a6472b07dc710e83a1153b0fbd86e51712c0fe09c756fa7e0`.
The commands cover the registered test targets of both groups. No test module was
added, and no group-contract change was required. Full-suite discovery was not
needed for this bounded export; it was not run.

Final regression file SHA-256:
`9779354861022122010051c98789591df44ae4f82bd7e1ba6f0eecbdfcd6beb2`.
Fresh admission before each serial check permitted one process; sampled CPU
ranged from 8.86% to 12.50%, available RAM from 42.37 to 43.18 GiB.
One fully used logical core represents 6.25% of host capacity.

Vite reported its chunk-size warning. No failed or skipped final tests were
reported. These are implementation checks, not independent review, native-app
acceptance, live-service validation, integration or installation evidence.
CI, base management, stacks and merge remain with the portfolio root.
