# WIK-VAL successor source receipt

Artifact Type: source-receipt
Purpose: Hand the validation-only successor to the serial Mini verifier.
Authority effect: none

## Source and scope

Repository: `Jones-Systems/HQ`. Branch: `work/hq-recovery-wiki-validation-successor-20261112`.
Base: additive Wiki checkpoint `586959e21e233829c7998533929edf9709921d2b`.
Accepted recovery amendment: `e9db4f61b0688f3727e4be4e37d00521131fc6f3`, recovery outcome,
writers, capsules, execution and assembled-head acceptance sections; accompanying resume Work Note read.
Shared bridge is absent; supplied host snapshot and HQ agreements apply.

Source acknowledgement: adapted from the retained validation implementation at
`352df74abde09f5467a05f8542ff6c129358ca76` and selected validation-only source hunks at
`3860d239c655b99c4c33fa8d82d1362b73382e74`. These objects were read without identity metadata.
No merge or ancestry reuse of the unpublished recovery object was performed. Its original
branch, worktree and pending publication decision remain outside this successor's ownership.
The literal inventory comparison retained all 13 original validation paths and selected five
additional lifecycle files, relocated to the authorized `modules/wiki/core/scripts/` cone.
There is no duplicate `modules/wiki/scripts/` tree.

## Source changes

- Validation tools and synthetic tests live in `core/scripts`; imports, permission-model read root,
  CLI usage and documentation resolve from that location. Existing aggregate assertions remain.
- Both landed `options.exec` and `options.spawn` are wrapped. Successful starts are measured by
  `spawn` events, with phase captured at seam invocation; failed starts require a close without a spawn.
  Every observed direct child remains owned until confirmed close, including retired batch readers.
- Collector shutdown closes the source and then confirms tracker cleanup before returning lifecycle
  figures. Cleanup kills only captured children and has a five-second confirmation bound; unconfirmed
  cleanup prevents a successful report. Handled signals and fixed unexpected-failure handlers use the
  same cleanup. Uncatchable termination cannot execute JavaScript cleanup.
- Report v2 explicitly declares all seven lifecycle counters in its closed schema; pinned vocabulary
  and rejection cases cover extra, missing and string-valued lifecycle keys. No free-form output added.
- Synthetic process source checks the five one-shot Git commands and two batch starts after forced
  retirement/replacement. Batch argv remains exactly `cat-file --batch`. Additional synthetic source
  covers direct-exec nonzero exits, failed starts, owned cancellation and an unrelated peer.
  Page expectations still use Git's own listing; process counts are independent of page counts.
- Validation scratch owns unique exact roots; teardown and handled signals await owned-child closure
  before removal and retain roots if closure fails. No sweep or runtime Git seam change is included.
- Package test discovery adds only `core/scripts/test/*.test.ts`; core tsconfig adds only `scripts`.
  Core README links the tool without replacing the additive contract or batch-allowlist documentation.
  Table assertions use the landed index-rules version rather than the predecessor's version 1.

## Static evidence only

Syntax-only `node --check` passed for all 17 selected TypeScript files using local Node v26.12.1.
All 48 relative TypeScript import targets exist; both edited JSON files parse. The final source diff
passes `git diff --check` and literal write-cone review. Core runtime, contract, app and UI are
byte-identical to the base. No dependency, root configuration or workflow edits are included.
No tests, typechecks, builds, installs, servers, app/browser/native launches, private config or corpus
reads, PRs, integration merges or operational effects were performed. Syntax parsing executes no
imports or test/application code and is not pinned Node 24.19.0 behavior evidence.

## Unrun serial verifier commands

After explicit heavy-slot release and fresh admission, the single Mini verifier binds the published
source SHA and uses pinned Node 24.19.0, existing dependencies and campaign compiler controls.
From the repository root, run the focused suite OR full Wiki discovery, then the dedicated typecheck:

```sh
node --test --test-concurrency=1 modules/wiki/core/scripts/test/*.test.ts
node --test --test-concurrency=1 modules/wiki/contract/test/*.test.ts modules/wiki/core/test/*.test.ts modules/wiki/core/scripts/test/*.test.ts modules/wiki/ui/test/*.test.ts modules/wiki/app/test/*.test.ts
node_modules/.bin/tsc -p modules/wiki/core/tsconfig.json --noEmit
```

Full Wiki discovery subsumes the focused suite; repeat only for a changed source or diagnostic need.
The coordinator owns subsequent required Foundation checks, execution and queue-time measurement,
and committed synthetic assembled-head acceptance. No private-source CLI run is authorized here.
Lifecycle assertions, signal cleanup, privacy, permission-model behavior, type correctness, timings
and additive-contract consumer compatibility remain unqualified until that verifier runs.

## Shared hunks and holds

No shared source hunk is requested. INT should ensure the dedicated core tsconfig is included in
its verification commands; the existing recorded core-typecheck CI gap remains unrepaired here.
No root workflow edit is requested by this capsule. Retained P2–P4 findings remain unselected and
unrepaired; historical test totals and timing do not qualify this head. Source completion is distinct
from behavior qualification, integration, activation and release readiness.
