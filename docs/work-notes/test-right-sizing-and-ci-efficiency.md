# HQ test right-sizing and CI efficiency

Artifact Type: work-note
Artifact ID: worknote.hq-test-right-sizing-ci
Purpose: Preserve the HQ right-sizing decisions, CI measurements and delivery gates.
Continuity owner: HQ test right-sizing workstream
Consumers: HQ contributors and integration owner
Authority effect: none

## Accepted outcome

The October 24, 2026 owner assignment covers a full owned-test pass, separate
removal PRs with reasons, a final bulk review and its restores, fast required
PR checks, and a native tier of three to five critical journeys placed nightly
or on demand. Required feedback targets are median at most ten minutes, p90
at most twenty minutes including queueing, and each required job at most
six minutes thirty seconds. No failing test is removed, skipped or weakened
to get green. No change to repository protection, credentials, signing,
installed software, other contributors' PRs or shared integration refs is
included.

## Source and ownership baseline

- Main baseline: `bc8202a9731d51922c7cddde91f6ada0074adc1d`.
- This baseline contains Planner and CLI source, 18 test files, no desktop
  application, no native acceptance harness, no workflows and no agent guide.
- Foundation reference: `b7b8c29dbc0feb73787b98bf926a90c3edfb21ea` on
  `work/hq-foundation`; its tree has 334 test files, counted by `.test` JS/TS
  and `test_*.py` filenames. This is a different, unmerged source population.
- [HQ#50](https://github.com/Jones-Systems/HQ/issues/50) is the existing
  integration coordination record. Foundation PR #2 retains its explicit
  integration/native acceptance hold. Shared configuration and integration
  refs retain their existing owners. This workstream cannot import the
  application into main as a prerequisite to changing its tests.
- Existing related candidates are #135/#138 (native acceptance), #141/#142
  (updater/package/signing), and #145 (Design CI batching). They are read-only
  references, not adopted PRs. This workstream does not push to or close them.
- Graphify has no selected HQ graph; current source and GitHub readbacks supply
  the evidence instead.

## Executed main baseline

Linux, Node 24.22.1, Python 3.13.5; each command ran serially after a fresh
same-host admission allowed one test process. The tests use synthetic stores
and owned child processes. No native, installed-app or cross-host claim follows.

| Group | Command from group directory | Cases | Result | Runner duration |
| --- | --- | ---: | --- | ---: |
| Planner Python | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests` | 69 | pass | 1.807 s |
| Planner client | `node --test --test-concurrency=1 'tests/*.test.mjs'` | 29 | pass | 0.703 s |
| CLI, including actual disposable Planner | `HQ_CLI_E2E=1 node --test --test-concurrency=1 'test/**/*.test.mjs'` | 85 | pass | 8.473 s |
| Total | | 183 | no failures, skips or todos | |

The Python discovery already executes contract drift tests, including the real
HTTP exchange capture. A second standalone contract capture is duplicate work.
Scratch readback after these commands found no retained per-invocation roots.

## Execution constraints

The root owns Git and all source writes in the declared task worktree.
Research children are read-only. No sudo is authorized. The explicit mode is
Frontier Max, with Astra/Max initial planning and the owner-selected bulk review
tuples. The installed preference CLI does not recognize the Max mode spelling;
no shared preference was changed. Native registration is unavailable because
the app invocation returned a synthetic launch identity rather than a verified
native project-thread identity; none is guessed or enrolled.

## Main test decisions

The full source assessment found no complete case with a clear removal benefit.
Imported Planner baseline tests are preserved. Counts below are expanded cases,
matching the executed 183-case baseline; assertion loops and Python subtests are
not counted as additional cases.

| Test group | Cases | Decision and reason |
| --- | ---: | --- |
| Planner app smoke | 3 | Keep: boot, routing and display-zone wiring cross the renderer boundary. |
| Planner client logic | 8 | Keep: date precision, filtering, review and ordering have distinct rules. |
| Planner display zone | 6 | Keep: timezone/DST boundaries protect an existing regression. |
| Planner render smoke | 10 | Keep: view-specific branches, literal owner text and coarse dates remain distinct. |
| Planner store | 39 | Keep: transactions, retention, revisions, persistence, imports and recovery protect durable data. |
| Planner server | 22 | Keep: request guards, framing, routes and fingerprints cover different boundaries. |
| Planner contract | 4 | Keep: reproducibility, wire capture, manifest completeness and cleanup are separate contracts. |
| Planner references backend | 4 | Keep: reopen/import/restore/batch persistence cannot be proved by CLI mocks. |
| Planner references UI | 2 | Keep: rendering/editing preserve provenance and prevent markup interpretation. |
| CLI core | 7 | Keep: discovery, parser, precedence, schemas and actual launcher behavior. |
| CLI reads | 9 | Keep; add one wiring test for explicit timezone precedence on relative-date writes. |
| CLI transport | 14 | Keep: route restrictions, timeouts, redirects, classification and body limits. |
| CLI date writes | 5 | Keep: date freezing, precision, DST validation and pre-send refusal. |
| CLI writes | 14 | Keep: no retry, unknown outcomes, durable intent and cancellation protect writes. |
| CLI replay | 7 | Keep: modern/legacy recovery, endpoint binding and original bytes are distinct. |
| CLI batch | 16 | Keep: atomicity, durable progress and completed-prefix recovery avoid duplicate writes. |
| CLI references | 9 | Keep cases; seven direct assertions duplicate canonical vectors, pending path ownership. |
| CLI actual-service E2E | 4 | Keep: real service interoperability and success/failure/signal teardown. |

The seven duplicate assertions use the same `conforms(referenceEnvelope, ...)`
boundary already exercised by named vectors `utf16-boundary`, `utf16-overflow`,
`source-revision-overflow`, `extra-key`, `scheme`, `route-overflow` and
`destination-extra`. A removal-only PR would remove zero cases/files and claim
no measured runtime saving. These validation assertions require the final
security-sensitive bulk review. PR #94 currently changes the same file, so no
removal is performed before the collision is resolved.

Two further real gaps are post-send intent-file failure preserving the known
receipt, and contradictory replay replies preserving uncertainty without a
retry. Their existing test files overlap #82/#86. They remain proposed test
additions until exact ownership is assigned; no competing behavior repair or
existing review finding is adopted.

## Integration CI baseline

These measurements describe integration branches, not main. The latest 100
PR workflow runs contained 70 successes, 28 cancellations and two failures.
Across 21 heads with all three fast workflow families successful, the
workflow-created-to-latest-update completion proxy had median 82 seconds and
nearest-rank p90 109 seconds.

A job-level sample of five heads (125 jobs across fifteen workflows) gives:

| Head | Design / CLI / foundation run IDs | Summed job minutes | Queue-inclusive completion |
| --- | --- | ---: | ---: |
| `b7b8c29` | 40043338297 / 40043338183 / 40043338182 | 9.05 | 62 s |
| `b5b07bf` | 39925384520 / 39925384367 / 39925384502 | 9.60 | 84 s |
| `cab2de7` | 39924765938 / 39924765970 / 39924765945 | 8.58 | 112 s |
| `6dd4694` | 39927522905 / 39927522878 / 39927522847 | 9.12 | 77 s |
| `bbbdd2c` | 39927044520 / 39927044462 / 39927044455 | 8.92 | 91 s |

Sum each job's completed-minus-started interval: total 45.27 job minutes,
per-head median 9.05 minutes, p90 9.60 minutes. Completion is earliest workflow
creation to last job completion: median 84 seconds, p90 112 seconds, with
initial queue times of 2–12 seconds. These are execution intervals, not billed
minutes. Actual push timestamps were not available in this sample, so true
push-to-last-required completion remains unknown.

The package workflow's fifteen first attempts had zero successes, eleven
failures and four cancellations. Diagnosed causes include Planner reverse-DNS
startup blocking (a bounded repair already belongs to #141), resource admission
refusals, and unavailable native process inventory. These do not justify
weakening tests or safeguards. There is no package qualification claim.

## Foundation test decisions

The read-only pass scanned all 316 foundation-only test files at the pinned
revision, then inspected candidates and their surviving coverage. No expanded
whole-application case total or native pass is inferred. No skip/todo/only
markers were found in test bodies. Imported Planner tests, Work's upstream
Planner copies and copied wire fixtures remain excluded.

| Proposed removal | Cases | Category and reason | Surviving coverage |
| --- | ---: | --- | --- |
| `modules/work/skeleton.test.ts` | 2 | Superseded bootstrap exports/mount. | `nav/test/registry.test.tsx` exports and Board/home; `nav/test/domain.test.tsx` six passive destinations. |
| `modules/social/skeleton.test.ts` | 2 | Trivial dependency and superseded mount. | `nav/test/registry.test.tsx` exports/Overview; `nav/test/domain.test.tsx` passive mount/remount. |
| `packages/hq-ui/skeleton.test.ts` | 1 | Trivial package/constant check. | `test/preserved-content.test.tsx` marker output, scheme changes, matte and validation. |
| Wiki core index: `parameters are the plan values` | 1 | Redundant literal parameter check. | Adjacent independently hard-coded scoring/ranking reference. |
| Wiki app static: `the expected files exist` | 1 | Trivial four-filename inventory. | Client, mounted app, CSP build and retained import-boundary checks. |
| Wiki core static: directory-layout inventory | 1 | Obsolete implementation-lane layout constraint. | Core functional suites and retained purity/no-shell/no-network/no-write scans. |

These are proposals, not performed removals: their exact proposed delta is
three files and eight cases. Foundation would have 331 test files instead of
334 before the independent CLI gap addition. No runtime saving is measured.
Keep production behavior and all remaining assertions unchanged when an
authorized removal-only PR is prepared.

| Remaining area | Decision and reason |
| --- | --- |
| Desktop security, preload, services, sources/export and connector | Keep: sender identity, closed IPC, OAuth, limits and uncertain durable writes are distinct. |
| Desktop preview and shell integration | Keep: capture coherence, cancellation, passive navigation and restoration cross component boundaries. |
| Design annotations | Keep: anchor identity, generation fences, redaction, persistence and undo. |
| Design canvas/compare | Keep: geometry, rendering, controllers and revision truth protect separate behavior. |
| Design components | Keep: sandbox, frame/nonce identity, immutable revisions and motion sampling. |
| Design discovery/projects | Keep: partial state, ordering, containment, cancellation and immutable versions. |
| Design flows | Keep: graph/player semantics and real rendered edges; generated-case cost remains unmeasured. |
| Design imports/references/producer | Keep: rights, provenance, filtering, idempotency, containment and atomic failure. |
| Design requests/connector | Keep: freeze/send durability, consumed confirmation, uncertainty and owner fences. |
| Design composition/storage | Keep: crash recovery, projections and renderer safety; preserve shipped regression coverage. |
| Design JCS | Keep: separate serializers and deliberately different rejection/digest semantics. |
| Design taste/UI | Keep: journal integrity, opt-in, accessibility, session preservation and evidence trustworthiness. |
| Work beyond bootstrap | Keep: guarded movement, replay, dates, undo, export and live compatibility. |
| Social beyond bootstrap | Keep: validation, reconciliation, capabilities, cancellation and explicit execution. |
| Wiki beyond named candidates | Keep: bounded read-only Git, parsing, freshness, stale-response refusal and safe rendering. |
| Shared contracts/UI | Keep: type compatibility, no execution, accessibility and reference actions. |
| Design store, all ten files | Keep: faults, real termination, migrations, locks and corruption protect durable data. |
| Acceptance/storage harness | Keep: peer survival, truthful results, environment isolation and capacity/cancellation. |

## Initial plan and ownership gates

Astra/Max completed initial planning against the exact source references above.
The accepted sequence is:

1. Add the isolated CLI timezone wiring regression in `reads.test.mjs`, with
   production behavior unchanged; run focused and full main checks.
2. Publish this independently qualified main work and the read-only assessment.
3. Resolve exact overlapping ownership before reference removals, other gap
   additions or CI source edits. Keep removals in their own PR.
4. On an authorized native source base, cap routine journeys, shrink only
   unneeded harness code, place native/package work off the ordinary PR path,
   and preserve release acceptance obligations. Build on #145 for Design CI.
5. Run the final bulk review over all decisions; apply its restore/gap list,
   merge only qualified owned PRs with a head guard, and report actual outcomes.

The concrete CI/native proposal is in the
[engineering spec](../engineering-specs/test-right-sizing-and-ci-efficiency.md).
Shared CI paths already exist in foundation PR #2, reference removals overlap
#94, and native/package changes overlap #135/#138/#141/#142. The current
assignment does not name those PRs for takeover. The smallest owner decision is
a bounded source assignment and PR base for successor work, together with
responsibility for reconciling its changes into foundation; foundation-to-main
integration and the other candidates' holds remain separate.

## Delivery ledger

The independent timezone case passes its ten-case focused file and the full
86-case CLI suite with real Planner opt-in, no skips, in 8.862 seconds. Combined
with unchanged Planner discovery, main's qualified case count is 184 across
the same 18 files. No test removal or CI placement change has been performed.

Pending: source publication,
bulk review, restores, required-check declaration, and final before/after
evidence. The broader goal remains active until its complete finish line is
directly verified or a precise external gate is reported.
