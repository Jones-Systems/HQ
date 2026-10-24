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
to get green. No change to repository protection, credentials, signing or installed software is included. The later explicit successor authorization below permits only bounded integration-branch advances through this workstream's own PRs.

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
  (updater/package/signing), and #145 (Design CI batching). Their existing PRs remain preserved. The authorized successors below target their relevant source branches without merging or closing those PRs.
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

### Owner-authorized successor route

On October 24, 2026, M Jones explicitly selected **“Authorize scoped integration
successors and their qualified merges”** for the proposal in PR #148. This
covers resolving overlapping test, shared CI, native and packaging ownership
with #2/#94/#82/#86/#135/#138/#141/#142 and using their relevant integration
bases instead of main. Merging this workstream's qualified successor PRs may
advance those named source branches. Existing PRs are neither merged nor
closed; foundation-to-main and release/install holds remain intact.

Each successor uses a dedicated non-main worktree with the root as sole Git
owner. Builders receive disjoint file scopes and cannot mutate Git. No sudo,
credentials, rulesets, signing, deployment, destructive cleanup or unrelated
integration is authorized. The approval ends when these scoped successors,
their bulk review/restores and the workstream report are complete.

The root owns Git in each declared worktree; builders have bounded, disjoint source scopes and no Git authority. Research and review children are read-only. No sudo is authorized. The explicit mode is
Frontier Max, with Astra/Max initial planning and the owner-selected bulk review
tuples. The installed preference CLI does not recognize the Max mode spelling;
no shared preference was changed. No shared runtime preference or enrollment is changed.

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
`destination-extra`. Removal-only PR #154 removes zero cases/files and claims no measured runtime saving. These validation assertions require the final
security-sensitive bulk review. The owner resolved the #94 collision by authorizing the successor into its source branch.

Two further real gaps are post-send intent-file failure preserving the known
receipt, and contradictory replay replies preserving uncertainty without a
retry. Their existing test files overlap #82/#86. The owner assigned successor bases; #152/#153 add two cases each without a production repair or adoption of the existing PRs.

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

PRs #149/#150 perform exactly these removals: three files and eight cases. Foundation now has 331 test files instead of 334. No runtime saving is claimed for this small removal delta. Production behavior and remaining assertions are unchanged.

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
The owner resolved the source-assignment gate through the bounded successor authorization above. Existing source PRs and their broader integration holds remain intact.

## Delivered scope and measured after state

Main and the source branches remain separate populations. Do not sum the rows below into a fictional assembled application. The full foundation pass comprised the 18 main files plus all 316 foundation-only files; the keep/removal reasons above cover every group.

| Population / runner | Before | After | Evidence |
| --- | ---: | ---: | --- |
| Main Planner + CLI cases | 183 | 184 | #148: 69 Python + 29 client + 86 CLI; real Planner enabled, no failures/skips/todos |
| Foundation test files | 334 | 331 | Exact tracked filename inventory at b7b8c29 and the merged foundation head |
| Foundation root Vitest cases | 1,800 | 1,795 | Three bootstrap files removed; full local and hosted discovery pass |
| Foundation Wiki Node cases | 509 | 506 | Three structural/constant cases removed; full local and hosted discovery pass |
| Foundation Design cases | 1,523 | 1,523 | 1,408 Node + 115 Vitest, complete section discovery; unchanged |
| Foundation CLI/Planner cases | 183 | 183 | Preserved foundation source; the independent main/source-branch gaps are not silently imported |
| Foundation portable acceptance/storage cases | 31 | 31 | Existing cases now execute in required PR CI, zero failures/skips/todos |
| Foundation total discovered cases | 4,046 | 4,038 | Distinct runner populations above; eight removals. Previously required PR execution covered 4,015, now 4,038 because 31 existing cases gained placement |
| #82 successor CLI cases | 91 | 93 | #152 adds applied/unknown final intent persistence cases; real Planner enabled, no failures/skips/todos |
| #86 successor CLI cases | 91 | 93 | #153 adds contradictory resend/lookup outcomes; real Planner enabled, no failures/skips/todos |
| #94 successor CLI cases | 90 | 90 | #154 removes seven duplicated input assertions, no cases/files; 87 pass and three unchanged pre-existing TODOs |
| #138 native portable cases | 22 | 22 | Three obsolete simulator tests removed with implementation; closed-read, routine-result and rejected-mutation checks added |
| Native routine journeys | No bounded routine tier | 4 | Clean candidate fa67027; exact-head Linux Electron run passed in 4.970 s with the passive-mutation oracle |

The foundation expanded count combines the baseline hosted root/Wiki/Design/CLI/Planner discovery with the unchanged 31 portable cases verified in the new hosted required job. It excludes non-test native journey scripts and manual acceptance obligations. Assertions inside loops and Python subtests are not extra cases. The two source-branch 91-case before counts and native 22-case before count are derived from their exact case deltas; they are not separate baseline execution claims. No runtime saving is attributed to the eight removals.

Removal categories: four superseded Work/Social bootstrap cases, one trivial UI constant/package case, one duplicate BM25 constant case, two file/directory layout pins, seven duplicated reference inputs, and three tests of a deleted harness simulator. The simulator removal belongs with its implementation change in #156; all other removals are isolated in #149/#150/#154. Additions: one timezone wiring case on main, two final-intent persistence cases, two contradictory replay cases, the three portable harness checks described above, and one signed-release workflow reachability case. No production behavior changes were needed.

The #94 TODO diagnostics are retained: read-time date derivation rejects a stored DST-gap time, and lone-surrogate validation permits a string that later fails UTF-8 JSON response encoding, yielding HTTP 500. The legacy-port TODO body passes. No TODO/skip marker or failing assertion was added, removed or weakened. Their original HQR-A3 integration dependency remains a limitation; 87-pass/three-TODO is not all-green acceptance.

## CI result and placement

#151 declares required/advisory checks in foundation's AGENTS.md. Required: Foundation typecheck/tests/build, both CLI/Planner jobs, Design inventory, every emitted Design section job and its fan-in. Foundation and CLI/Planner have six-minute timeouts, all-base/all-path PR code events, manual dispatch and cancellation. Native/package/nightly are advisory for ordinary source merges; missing/cancelled/skipped required execution is not a pass. No protections or rulesets changed.

Removed duplicate work: two unnecessary dependency installs, a second real HTTP contract capture, a second Electron build and main-push copies of the fast workflows. Foundation builds once then runs complete Vitest/Wiki and portable fixture/storage discovery. #145 retains Design batching ownership; its workflow is untouched.

| Fast CI metric | Before: five heads | After: #151 and refreshed #150 |
| --- | ---: | ---: |
| Summed job execution minutes, median | 9.05 | 8.93 |
| Summed job execution minutes, nearest-rank p90 | 9.60 | 9.08 |
| Workflow creation to last required completion, median | 84 s | 83 s |
| Workflow creation to last required completion, nearest-rank p90 | 112 s | 95 s |
| Longest observed required job in after sample | — | 93 s |

After sample: #151 has 9.083 job minutes / 95 s (runs 40104011663/40104011672/40104011681); #150 has 8.767 / 71 s (40104217389/40104217414/40104217499). Each has 25 successful required jobs. The timestamp recorded immediately before #151's push gives a conservative push-to-green upper bound of 102.30 s, including publication and queueing. Earlier push timestamps are unavailable, so workflow-created timing is a proxy for the statistical comparison, not a claimed exact historical push-to-green distribution. Both observed after heads are comfortably below 10-minute median / 20-minute p90 targets; two heads are too few to establish a durable percentile. Execution intervals are not billed minutes; runner variability prevents a causal runtime-saving claim from this sample.

Packaging baseline remains zero successes in 15 attempts (11 failures, four cancellations). #155 demotes ordinary packaging to nightly, relevant `ci/package` PR label, dispatch and existing release tags, plus the preserved explicitly enabled canonical-main signed-release exception. Both architecture/signing/admission/cleanup boundaries remain. No macOS runner was triggered by this workstream; the signed-release activation variable and trust gates are unchanged. This fixes placement; it does not certify a working package. Existing startup/resource/process-inventory failures remain release obligations.

#156 runs exactly four critical Linux native journeys by nightly, `hq-native-journeys` PR label or dispatch. The authorized #138 source base contains 27 tracked acceptance JavaScript modules; they shrink from 2,934 to 2,864 lines (70 fewer, including the review gap fix). Production modules excluding test files shrink 2,485 to 2,433 lines; the explicit native/qualification script inventory remains because cleanup, evidence and separately held release journeys still need it. The four observed journeys cover shell restart, Work uncertain capture/explicit lookup, confirmed Work persistence without replay, and gallery enrollment/last-good recovery. Full/selected acceptance preserves every reserved row and held HQ-07/HQ-09H edge.

The final native run at fa67027ae119ad1d27ac0c38443dfbfcedd5484f used a fresh clean-candidate build, real Electron/preload and owned Planner/database and passed in 4.970 seconds. It observed zero Work mutations before capture and zero Social mutations through teardown. Build inventory SHA-256: `9853eb0221d580538db68222fc839959bc6b34c84c89a40ed36ac979c34709c4`. Cleanup removed the exact runtime root, closed captured children and left zero remaining children. No native pass is inferred for Social saves/references, Wiki references, live preview, native chooser/displayed image, distinct-host or installed-app qualification. Nightly schedules become active only after the corresponding workflows reach the default branch; the foundation-to-main hold deliberately prevents that promotion here.

## Bulk review and delivery ledger

The single final Astra/xhigh bulk review completed. **Restore list: empty.** Independent source inspection confirmed the bootstrap replacement coverage, independently hardcoded BM25 scoring, all seven canonical reference inputs, production codec/uncertainty coverage and the five meaningful CLI gap additions.

The review found a P1 workflow wiring regression: removing main push entirely made the existing enabled signed-publication graph unreachable. PR #157 restores only that existing trigger/condition exception behind its unchanged activation gate, and adds a real workflow-condition/release-guard reachability test. It does not enable signing or publication. The 18-case packaging file passes without skips; the check itself runs on the existing package nightly/label/manual tier.

The review also found a meaningful native gap: rejected unsolicited mutations were recorded but did not fail the shell qualification. The native successor now requires zero Work mutations before intentional capture and zero Social mutations through teardown, with a portable negative oracle. Its 11-case changed fixture/scenario group passes without skips, including rejected POST/PUT/PATCH/DELETE attempts against both fixture and real-Planner ledgers. This needs no simulator restoration.

A local repeat of portable/storage checks exposed the VPS's inherited 0002 umask: test-created group-writable fixture directories were correctly rejected by storage admission. That run was stopped through its exact owned process group, and its one surviving empty fixture root was removed by exact path. All 24 storage cases pass under umask 0077 with a new private task-owned TMPDIR; no assertion, guard, skip or test body changed. Hosted discovery already passed all 31 portable cases under its normal fixture permissions. Local reproduction requires those private-fixture prerequisites.

| PR | Scope | Target | Integration result |
| --- | --- | --- | --- |
| #148 | Timezone wiring gap + assessment | main | Merged ca597564 |
| #149 | Work/Social/UI bootstrap removals | work/hq-foundation | Merged a0f975c1 |
| #150 | Wiki structural removals | work/hq-foundation | Merged 34d73a0f |
| #151 | Fast CI + required/advisory declaration | work/hq-foundation | Merged 916dcc71 |
| #152 | Final intent persistence gap | review/hq-main-a8-cli-writes | Merged e72ce522 |
| #153 | Contradictory replay gap | review/hq-main-a7-cli-transport | Merged 330c0e85 |
| #154 | Duplicate reference inputs | work/hqr-a9-harness-20261020 | Merged f9648bb2 |
| #155 | Package placement | work/macos-signing-hq-20261022 | Merged 2057eb32 |
| #156 | Native cap + harness/placement | work/ui-fidelity-t7-macos-20261022 | Bulk-review gap correction and current-head qualification pending |
| #157 | Preserve gated signed-release graph | work/macos-signing-hq-20261022 | Merged 354e7aea |

All performed merges used the exact head guard and kept branches. #152/#153/#154 source bases have no emitted hosted workflows; qualification is the full local real-Planner CLI evidence above, with the #94 TODO debt explicitly preserved. The application successors retain their emitted Foundation/Design checks. Existing PRs #2/#82/#86/#94/#135/#138/#141/#142 remain open and unmerged. No release, installation, signing, main foundation promotion or broader integration has occurred.

Later work: integrate the preserved source PRs under HQ#50, activate default-branch schedules through that authorized promotion, land the existing Planner fixes before dropping their TODO markers, qualify packaging and all reserved native/release obligations, and gather a larger queue-inclusive CI sample. These are held application/release obligations rather than hidden passes in this scoped successor delivery.
