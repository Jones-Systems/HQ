# CLI, Planner and mounted Work composite acceptance

Artifact Type: evidence
Artifact ID: evidence.hq-agent-cli-integration
Purpose: Record bounded independent verification of the original CLI composite acceptance.
Decision owner: M Jones
Consumers: HQ integration owner and CLI delivery lane
Authority effect: none

## Revision and scope

Independent verifier result: **pass** for
`spec.hq-agent-cli#task.i.001` / `spec.hq-agent-cli#ac.i.001`
on HQ candidate `e53943092566e902bf24e698fa31e0c0f2fbb912`.
The coordinator owns Git and delivery. The verifier wrote only this evidence file;
the one-off harness and config ran in an exported disposable source copy.
Shared enrollment was unavailable because HQ's shared-guidance bridge was absent.

Included heads, all independently confirmed ancestors of the candidate:

| Slice | Included head |
| --- | --- |
| B1 | `d806e4a545cd16b1cc84052ef65d99e7c142b360` |
| F | `67594ade88d5078e57721926b54c2dc3c8844df3` |
| C repair | `3452ec8628ee6410cff7e814ccb49b9c00dc9cf5` |
| D | `b190fbf41e7ccb3777468107e6c0ffadc1a6a2bf` |
| E bridge | `b548dc3494483e0ff48f6ede277516508f1ed35a` |
| Production binding | `697081144e28714f963009f478527afb7765d8ca` |

The Planner tree is `c3aeccfb3c8af7f1a0e23763cbc4d583df2e7c3d`;
the CLI tree is `24f88586cd2d980786f38bcf0e4532e5c8bbe23f`.
Both are byte-identical to the coordinator's passing four-test CLI E2E candidate
`bc8202a9731d51922c7cddde91f6ada0074adc1d`.

## Independent behavioral proof

One test created five synthetic items through the actual CLI using its fixed-clock
driver and a disposable real Python Planner on a dynamically assigned loopback
port. It compared the exact five IDs and both date kinds/values in CLI list output,
direct backend state, and the Work live port. It mounted the production
`createServiceDomains` Work selection, using actual `createServices/sendHttp`
transport, and compared all five rendered `data-card-id` values. Each card was
opened, and both target and deadline editor values were checked independently.
The three-item and two-item date groups retained distinct target/deadline dates.

A subsequent CLI title update left the mounted card stale until explicit
`workSession(...).store.poll()`; the refreshed card then showed the changed
title and the transport recorded the state read. The test also checked that the
HQ reference survived CLI/backend/port reads and the later update. Work's recorded
transport calls were all reads; no fixture fallback appeared.

This is mounted React in Happy DOM with a real synthetic backend. It does not
prove an installed Electron app, IPC/preload, a visible browser, live data,
a UI refresh button, or operational service activation. Explicit refresh here
means calling the existing Work store refresh API while the UI stays mounted.

## Check identity, environment and attempts

Affected groups supplied: `planner-service`, `hq-cli`, `work-live`.
Projection manifest: `docs/planning-evidence/hq-agent-cli/projection-catalog.toml`,
SHA-256 `5474ded6a63bc587924c6a7f52ade056c815fabca33729a1bf71646faa2e885c`.
This is the projection catalog, not a claim that a canonical mixed-language
group runner executed. The smallest independent check answered the missing
composite question; complete groups, typecheck and unrelated suites were not rerun.

Exact check:
`node node_modules/vitest/vitest.mjs run --config composite.config.ts`,
selecting only `apps/desktop/src/composite.acceptance.test.tsx`.
Environment: Linux, Node v24.19.0, Python 3.13.5, Vitest 5.0.5,
Happy DOM 21.0.3. Existing dependencies were reused without installation.
Package and lockfile bytes matched the candidate; explicit workspace aliases
resolved HQ source from the candidate export, not the dependency donor checkout.
The lockfile SHA-256 was
`9f710b4af1640207468cfdf320d907d9b1aa7e4961ff78eed9eb20c09d7276c5`.

Four harness executions occurred. Attempts 1–3 were harness setup failures:
Happy DOM fetch CORS for the direct backend read; an ambiguous Kind selector;
and a date input label including its format hint. The corrected harness used
Node HTTP for the independent backend read and scoped exact editor queries.
These were not product failures or failing-before evidence. Attempt 4 passed
one test, with no skipped tests. Assertions were retained, and each attempt's
harness/log/result was preserved privately.

Fresh same-host admission allowed exactly one serial test process for each run:

| Attempt | CPU used | Available RAM | One full core share | Result |
| --- | --- | --- | --- | --- |
| 1 | 9.40% | 37.79 GiB | 6.25% | Harness setup failure |
| 2 | 9.06% | 38.23 GiB | 6.25% | Harness query failure |
| 3 | 7.26% | 38.24 GiB | 6.25% | Harness query failure |
| 4 | 8.52% | 38.05 GiB | 6.25% | Pass |

The coordinator's implementation evidence, reused rather than rerun:
`HQ_CLI_E2E=1 node --test --test-concurrency=1 test/e2e/planner.test.mjs`
at `bc8202a9731d51922c7cddde91f6ada0074adc1d`, four passing tests,
captured as `cli-e2e.json` and `cli-e2e.log`.
This is distinct from the independent composite result above.

## Evidence custody and cleanup

Native artifacts are retained by the coordinator under the private continuation
evidence root. No temporary fixture, database, host address, or private artifact
path is published here. Artifact basenames and digests permit exact readback:

| Artifact | SHA-256 |
| --- | --- |
| `composite.acceptance.test.tsx` | `e03788b386be5f2b02169b7d9aacfcaa616dc777878dc81f110ecb9eec2e1dae` |
| `run-composite.py` | `8f91c3118d794b03e5cbe774b049f6a9f408109cb7e3e371cdb6f06c35537e3a` |
| `composite-attempt4.config.ts` | `eb9ae238f3f592933d5f7181311a0e8f020001021ec63fa9a2e14ba4780d582d` |
| `composite-attempt4.log` | `c498e970f9aabeea8f2901242821ee054ffc517235a33fadc89e15ec4d0a8824` |
| `composite-attempt4.result.json` | `4e88927345fb33990b63f6db89fd2c9b988ca0b1fdfdb85108e1c27f9b2c9121` |
| `composite-receipt.json` | `39eb4b2eef16fb274720af1eea6d04ccd9046f25999b1bc578bb07636baf917c` |

The complete receipt records the observed IDs, date values and rendered date
labels across the same execution. Per-attempt telemetry and cleanup results
are retained alongside it. Each Planner subprocess was stopped and its PID
absence checked. Every exact disposable export root was removed, including
the synthetic database and generated cache. The dependency donor was not changed.

The integration owner retains acceptance, cumulative delivery checks and any
operational activation decision. No merge, deployment, live-store backup or
service change was performed by this verification.
