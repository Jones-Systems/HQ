# HQ user flows and backend recovery

Artifact type: work-note
Artifact ID: work.hq-userflows-resume-20261112
Purpose: Continue the twelve paused HQ frontend/backend lanes through implementation, verification and authorized source delivery.
Owner: HQ recovery coordinator
Consumers: Recovery planner, scoped builders, integration owner and verifier
Authority effect: none

## Accepted outcome and boundaries

Resume the November 3 HQ campaign: make the planned Work, Social, Design, Wiki and Settings flows functional and match the established mockups, including motion, responsive feedback, inline errors and toasts. Finish the associated backend paths and integration. Current owner direction selects Blended Frontier Max for this workstream. All builds run on the Apple Silicon Mac mini. No laptop builds.

The prior thread is context; this work resumes its paused source assignment. Private Wiki access, real-account posting, signing, installation and deployment require their existing exact authorization. Preserve unknown outcomes and all owner-review holds. Foundation-to-main remains held. Repository merge policy requires a named integration owner and current exact-head checks; green CI alone supplies no authority.

## Current recovery evidence

- Source thread: HQ User Flows and Backend Buildout. Twelve lane handoffs were pushed under `docs/handoffs/hq-life-20261103/`, on their individual branches. This recovery checks the actual branches and successors instead of assuming the old summary remains current.
- Coordinator worktree: dedicated linked checkout, branch `work/hq-resume-userflows-20261112`, base `8945d156585510fbdf1515fad01798f416146b4e` from `origin/work/hq-foundation`. Root coordinator is the sole Git owner. Scope: this continuity record and the eventual accepted recovery spec/shared integration assignment. No substantive edits to the earlier thread's checkout.
- Initial open-PR survey: shell successors #200 → #206 → #208; Work successor #198 (old #186 draft still open); dev-preview #191; resource/evidence stack #177/#180/#182/#184/#193/#194; runtime #209; updater #212. #2 remains draft foundation-to-main. #85 explicitly holds Planner contract captures. These are overlap candidates, not automatically dependencies or taken-over work.
- Current foundation already contains the B2/B3/B4 assessments and F7 flow assessment (#187/#189/#188/#185), plus several later integration slices. Remaining implementation must be established by ancestry and file readback.
- HQ's `.agents/shared-guidance.md` is absent on the checked foundation. The owner-supplied immutable shared rules apply; absence does not authorize installing a bridge.
- Thread registration is unavailable: the prescribed local registry socket is absent. No registration or enrollment was attempted through an alternate route.
- Baseline CI readback at foundation `8945d15`: the required Foundation, CLI/Planner, Planner and Design family checks pass. The additional Social service contract/Python job fails on both #2 and shell #200. Run `42857959988` executes 514 Social tests; `test_runs.Refusals.test_concurrent_submissions_cannot_exceed_the_limit` observes eight accepted and ten refused responses instead of eight and twelve, with connection-reset tracebacks. Source diagnosis is the next bounded action; no test has been weakened or rerun. Native and packaging jobs were skipped and prove no execution.
- Research need: repository and handoff recovery is required before substantive planning. Existing product mockups and source are primary evidence. No new external product research is needed merely to recover this campaign.

## Recovery checkpoint and handoff

Coordination transfer is accepted. The receiving coordinator owns this linked worktree and its Git operations exclusively. Its matching native goal covers the full accepted source, verification and delivery outcome, but currently reads blocked; the owner-directed resume returned busy because a run is already active. Ordinary source work continues under the owner's renewed instruction without claiming that the native goal resumed. The origin's native goal remains paused; its existing delegated task collection and exact unknown-baseline reconciliation remain with that origin. Task-management rights and merge authority do not transfer through the handoff.

The Fable initial plan, independent Astra concept review and a verified continuation in the original Fable session are complete. The reconciled plan accepts the review corrections: restore B4 tooling, B5 validation and missing native-journey source; preserve all Design ports; assign one writer per shared file; reuse the existing Darwin runner; allow one serial test process total on the Mini. The accepted plan is encoded in the existing progressive Engineering Spec's recovery amendment. Source checkpoints below supersede historical active/done labels in the planning result.

The original builder turns ended before their scope corrections. New successors received explicit corrected cones; the original unpublished Wiki validation commit remains preserved and outside successor ancestry.

### Source checkpoints

All rows below are source-only and pushed unless explicitly marked otherwise. Static checks are recorded in each capsule receipt; builds, typechecks, tests and native behavior remain unrun.

| Capsule | Pushed source head | Composition / remaining qualification |
| --- | --- | --- |
| Social listener | `fa2728a9d8ed90abd7b6980c905d805fed5c96a0` | Composed; unchanged 20-client/8-accepted/12-refused oracle awaits controlled execution. |
| Work persistence spine | `cd1371e12182db9aaa09f7a7c809f8f07fd8f042` | Composed; coordinator added authorized, health-gated main construction/channel registration. Shell registration remains. |
| Planner–Wiki | `a4d5e0c371c03fce0bd2e2de058ba429ff063f45` | Composed; generator-derived pins/copies await full generator check and real local roundtrip. |
| Shell/reference checkpoint | `367cfb2159b85927bd04720c57d809e0970640ed` | Composed; module desktop hunks and fixture proposal remain for one shell owner. |
| Local checks / Darwin preview | `060e1f40320631ec94f64e451f7ea0ba8ee8e841` | Composed; exact Foundation/Design tooling hooks added without inventory/fan-in changes. |
| Wiki additive contract | `586959e21e233829c7998533929edf9709921d2b` | Composed; conditional index rebuild retained; excerpt-window finding unselected. |
| Corrected Wiki validation | `5a8cbe89673d105b6f391c10d68f42ebf9ed12c6` | Composed in `modules/wiki/core/scripts`; both Git seams and closed lifecycle reporting. Original unpublished `3860d239c655b99c4c33fa8d82d1362b73382e74` remains untouched, unpublished and outside successor ancestry. |
| Design ports | `b619d411ba0324fa781496474f186b60c05d1098` | Composed; capabilities, labelled fake answer and export port source; export stays disabled. Storage is `modules/design/app/storage/design-export.ts`. |
| Design host matrix | `a56209885c16c4fcbbb9b60bb4f5c72c7012614a` | Composed, 42 retained cases; Foundation alone owns execution. Root typecheck includes dedicated test-support config. No desktop inventory row or parser broadening. |
| Work queue / health | `bf30a4d7bd7b3b871e2ef0976495206b89e1c617` | Composed after independent fix-scoped review cleared both new P1s; regressions unrun. Prior P2 cleanup race and other recorded findings remain unselected and unwaived. |
| Social views | `fe2faa3e59e2f64548fe5e442d17556c5419b223` | Composed; four desktop hunks remain with shell owner. |
| Work frame / board / list / detail | `85d681b20bd1b61ca0868bca3bcd1b9bf699e3a6` | Composed; edge-card Alt+Left reservation authored, runtime unverified. Calendar/Plan/Review successor is composed below. |
| Settings / appearance | `3b7ae2f5db797ab12fe5650f7bfca86e13a6189d` | Composed on shell; Updates behavior retained; off-cone evidence and preview bytes preserved. Shell follow-up remains. |
| Six Design Sources views | `c06e5dcc0c7f106cef4406f57f1d9082a5a11bfa` | Composed; coordinator reconciles native rights wording with explicit UI rights choice. Core-view successor is composed below. |
| Four native journeys | `91ff491a4a184af8ae9ae8394d358369d6de2f30` | Composed; INT applies proposed runner/fixture/README source hunks. Native execution remains unqualified. |

Additional pushed checkpoints composed by the coordinator:

| Capsule | Pushed source head | Remaining work |
| --- | --- | --- |
| Work planning views | `79e9d49cfcd5a767407b28a52a5025903317e315` | Calendar/Timeline, Plan week and Review/Archive source; runtime and layout unverified. |
| Design core views | `82b41530a6388423b3cff8d68d20c92401d6f7b0` | Core screens, active project, retry and Annotations picker composed; INT reconciled four status/run-markup test assertions, keeping provenance and no-dispatch oracles. |
| Final shell wiring | `3bb13af3b3872bf52ad04606be9d0540d84810b3` | Social seed/scope, durability registration, Planner-health observations, Settings and reference fixtures composed. Capture must still adopt durable drafts. |
| Gated Social extensions | `90a3098684f4824508f16ea674388afbeeb218b5` | Service/client source composed with publishing off. Additive shared routes and closed desktop encoder integration remain pending. |

Recovery PR [#213](https://github.com/Jones-Systems/HQ/pull/213) is open and non-draft against `work/hq-foundation`. Ordinary local merges preserve retained ancestry and are not foundation merges. Source checkpoints are not accepted behavior.

### Remaining source work

The accepted flat capsules retain all twelve lanes: shell integration; Work main-process wiring, reviewed offline queue, health and five screen families; Social screens plus planned gated extension source; Design Taste/capabilities/export-port source, host matrix, six Sources views and main screens; Settings and Wiki views; additive Wiki contract; local checks/Darwin preview tooling; and four missing native acceptance scenarios. Generation, component execution, export enablement and live posting retain their gates. Optional review findings keep original severity and recorded disposition; they are not automatic repair assignments.

Design compose writers run capabilities → Sources → active-project/core views. Module builders consume the published shell checkpoint and report desktop wiring hunks to its one owner. Work queue consumes the Work-spine checkpoint and receives a correctness review before integration. Coordinator owns shared contracts, Electron main startup, workflows, root configuration and acceptance registration; exact overlaps with #209, #212 and the external storage/evidence stack require fresh reconciliation.

Product defaults remain: Plan week at `board/week` within the existing navigation order; Social and Work remain workspace-scoped; no Wiki revision history. Private-source authorization and old private scratch disposition remain unresolved and do not block synthetic source implementation.

### Mini verification admission

The updater campaign explicitly closed its unsigned preparation producers/groups/EOF, verified lock release and released the next one serial source-verification slot. Its signing/native work waits for this campaign's explicit closure/return. This release does not resolve the unknown baseline launch or qualify a generic source compiler controller.

The original baseline delegate request still returns “Remote delegation is durably pending reconciliation” with no task/child/admission identity. The originating parent retried its exact retained inputs after slot release; no authoritative no-effect or effect fence was returned. An empty task projection does not prove no effect. Do not start a replacement verifier. App-owned reconciliation or an authoritative fence for that exact request is required before heavy execution.

A separate Wiki UI source launch in the receiving coordinator also returned durable pending reconciliation. Its identical retry has no task handle; do not launch another Wiki UI builder or mutate its intended branch. This source-only uncertainty is distinct from the baseline effect. Exact inputs and error evidence are retained privately, outside public source.

Fresh same-host samples admitted the scoped source batches (at most two starts each), with normal memory pressure and zero swap traffic. They authorize no builds/tests or future reservation. Preserve the existing qualified lock identity without recreating it, and qualify ordinary source launch mechanics before compiler work.

Once admitted, one serial verifier uses task-local CI versions Node 24.19.0/Python 3.13.5, the qualified participating compiler controller and lock, fresh CPU/storage checks, and one host-wide test process. Queue: foundation baseline → Social repair → Planner–Wiki → wired Work spine → shell → dependency-ordered modules → assembled head. Existing alternate Node/Python versions are not identical CI evidence.

### Retained failure and acceptance evidence

A separate updater diagnostic at head `eff942d5aae8d4c5610772f11a123e460c8f7ced`, run `43212587934` attempt 2, job `131202757650`, reproduced four connection resets and counts 8/8 rather than 8/12 across 514 tests. This is additional failure evidence, not proof of root cause or of the repair. Social is advisory under current policy; six required fast checks there remain green.

Final acceptance binds to one assembled head and fresh Mini build: real Planner reference save/open/return; offline persistence/restart and unknown outcome without duplicate intent; Social save/failure/unknown; committed synthetic Wiki indexing/recovery/backlinks/status; first-run/reopened onboarding; remembered destinations; keyboard/reduced motion; light/dark/system appearance; narrow layouts; toasts with the native Design preview; Work/Social mockup comparison; and exact-head required CI with Design inventory and explicit gaps/holds. Browser captures supplement native evidence. Checkpoint success is not full acceptance.

Merge remains gated on this campaign's accepted integration-owner binding under the repository policy naming T1. Green CI alone does not release that gate. Foundation-to-main, private Wiki, live provider/posting, native enablement, signing, installation and deployment remain held.

## Source conflict preflight

Root ran Git's merge-tree calculation against foundation `8945d15`, without changing branch refs, index or worktree source. This is only a textual conflict check, not a build or semantic integration result.

| Candidate | Textual conflicts against current foundation |
| --- | --- |
| F2 Work lane | none |
| F3 Social lane | none |
| F4 Design core lane | `compose/closure-views.tsx`, `compose/fake-workspace.ts`, `compose/views/AnnotationsView.tsx`, `compose/workspace.ts` |
| F5 Design sources lane | none |
| F6 Wiki/Settings lane | desktop `modules.tsx`, Wiki app `domain.ts`, Wiki UI `index.ts` |
| B5 Wiki/integration lane | none |
| SHL successor scope branch (#208) | none |
| Work live successor (#198) | desktop Electron `services.ts` |

These results guide later owner-scoped integration. They do not authorize taking over open PRs or reverting newer contracts.

## Receiving coordinator source assembly

The source ledger above is composed in the exclusive coordinator branch using ordinary merges. Shared Work-local contracts are consumed once; main construction/channel registration and retained Design capability contracts were added by INT. External crash/updater and evidence PR heads were read before overlapping main/acceptance work; those independently owned branches remain untouched.

The root `typecheck` script includes the DSN-M strict desktop test-support configuration. Independent placement judgment corrects the old inventory proposal: Foundation root Vitest is the sole required executable owner of all 42 desktop matrix cases. Existing 20-row Design inventory, parser and fan-in remain unchanged. The separate batching timeout/policy discrepancy is recorded, not silently repaired or treated as measured compliance.

INT owns the exact Imports native dialog wording and corresponding assertions, plus removal of the temporary bridged-rights restriction once the dialog refers to the explicit UI statement. This closes the DSN-B/DSN-S handoff without enabling export or generation. New source regressions preserve incomplete-statement refusal and licensed-basis validation; no test execution is claimed.

INT applies the VAL-S runner registration, Social/Planner fixture controls and additive README documentation, preserving existing gaps/held dispositions, checkpoint/routine read-only Social fixtures and mutation oracles. The external host-gallery/preview stack is not imported or edited.

Two source-review P1s were selected and fixed: the missing health export assertion now follows the direct-health import contract; a request-ID rejection hold now blocks repeated/reconnected drains, survives restore and gates dispatch after persistence. Independent re-review found no new scoped issues. The P2 E2E cleanup race remains unselected; neither reliable cleanup nor production queue activation is qualified by these source tests. Original B1 findings retain their dispositions.

Remaining source work is capture durable-draft adoption, the Social shared encoder/contracts and four selected native-scenario P1 corrections. Wiki UI launch identity is unresolved. The previously active view/shell capsules are now composed. All layout, accessibility, native, emitted-store, cleanup, root execution and exact-version verification obligations remain open.

## Orchestration investigation and current source ownership

The owner explicitly requested renewed reconciliation and a separate investigation. The source/read-only investigation inspected the installed Jones Code revision. It found no exposed origin-journal lookup or authoritative fence for the two unknown remote-delegation requests. Repeated no-handle failures are consistent with local reservation/projection failure, but actual origin records are needed; neither execution nor no effect is proved. A foreign-looking generation name can be normal shared-producer metadata and does not establish cross-routing. Retained service-tier observations likewise do not prove the current turn's effective setting.

Fresh native readback shows the receiving coordinator's current run running, with its later run only queued. The exclusive coordinator worktree, branch, clean head and Git owner were reverified before resuming ordinary source composition under the owner's renewed instruction. This does not settle either unknown launch, grant Mini execution or certify the previously rejected native owner-input operation. The origin was asked only for another exact-request reconciliation, preserving its paused goal and retained duties.

The native-scenario source review found four selected P1s: Social selectors/save controls do not match the current screens; Work detail is a textarea; the Back pill includes a keyboard hint; and offline capture deliberately remains editable while its send is guarded. An isolated source fix is assigned. The new P2 Planner PATCH final-ledger gap is recorded and unselected; no automatic repair is assigned. A separate Work capture/nav owner is adopting the existing durable-drafts slot with explicit restore/mutation/save-failure rules. All new regressions remain unrun.

The static Mini launch capsule is not qualified. In addition to unresolved baseline effect, the pinned Vite/Rolldown Rust build threads need supported bounded controls; Go GOMAXPROCS alone is insufficient. No runtime download, lock acquisition, build or test was performed by the preparation task. Its private capsule remains outside public source.

The updater requested the heavy slot back for its distinct authorized attempt. The coordinator returned a continuing hold: unknown baseline effects prevent safe overlap or a closure claim. No live work was preempted, no signing/native attempt was authorized here, and no original approval was broadened.

## Current state and contributing threads

The assembled source checkpoint `2c5313d9f4d696e169c2ae472ee9c5923edccc0c` was pushed and its remote SHA read back. Foundation remains `8945d156585510fbdf1515fad01798f416146b4e`. The scoped native-scenario P1 successor is pushed at `17539f43f5f5aea040fd9c178ad6245eb35e3c54`; independent fix review is pending. Durable capture is pushed at `8e7d3b32192fd203b4c81119728faaef23742bbe`; independent correctness review and the explicit toolbar caller adaptation precede composition. The Social shared bridge owner is implementing the additive contracts and encoder. These checkpoints have no passing behavior evidence.

Subsequent source fan-in: independent native review cleared the four original P1s and their source was composed. Its additional P1 counted-Library selector is corrected in source with zero/nonzero badge regressions; fix review remains pending. Independent durable-capture review found no new P0/P1 and allowed conditional composition, now done. Its two P2 findings remain recorded/unselected in the specification. INT applied the explicit toolbar refusal/status caller hunk and authored unrun regressions; this does not waive those findings or establish fresh core/adapter restart recovery. Independent Social bridge review cleared `7e97082fd1cf03bed1cec8d363217ac04f488aaf` as a source candidate; INT applied the exhaustive absent-feature zero-call test hunk. All behavior remains unqualified.

First hosted Foundation run on PR head `b8f8198b4f1fa000fbd01ffc5ff3a56734ef1222` failed during typecheck, before tests: shared Social route drift, three shell/test typing issues, Projects view typing and fixture extension typing. INT corrected the bounded shell and fixture issues; Projects successor `55578f34b7326684ddf10046dcc3fb345929adb4` is composed. No assertions, required discovery or compiler checks were weakened. CI on the next assembled head is still required. The app's link operation returned an error, but a native PR-list readback confirms #213 is attached; no duplicate PR was created.

Pinned compiler research found supported Rolldown Tokio and Rayon per-pool controls, but no complete aggregate worker bound. Native TypeScript, libuv/NAPI and conditional JavaScript-worker paths require qualification too. Setting individual pools to one is only a candidate, not proof of the required total. The Mini execution and unknown-effect holds remain.

### Latest source and hosted CI disposition

This paragraph supersedes earlier pending source-review labels. Independent review
cleared the toolbar durable-draft caller and the counted Social Library selector
at `580a72a4`; no new findings were reported. The earlier four scenario P1s remain
source-cleared. Durable-capture P2s, final Planner PATCH-ledger P2, E2E cleanup P2
and original B1 findings remain recorded, unselected and unwaived.

Hosted Foundation on `9fc113c2` passed its build/typecheck, then failed root Vitest:
190 files passed and 19 failed; 3436 tests passed and 45 failed. Required CLI with
real synthetic Planner E2E and Planner contract/Python/Node checks passed on that
head. This is historical evidence, not passing evidence for its successors.

Source successors `f1a8904e` (Social schema/contract), `642e2399` (Work UI) and
`2fb0dc62` (shell/onboarding) are composed through ordinary merges. Their receipts
record per-failure diagnosis. INT adds the shared Portal and exact board hunk,
inert/accessibility-hidden toast exits with guarded actions and active F8 focus,
the motion test's DOM environment, and a Node URL constructor for the real-Planner
fixture path. Social's load-error assertion follows the existing typed notice.
No required discovery, package boundary, mutation oracle or failure assertion is
removed. These source repairs and their new regressions await exact-head CI;
no local tests, compilers, builds or native execution ran.

The latest exact origin retry still returned no baseline handle. Both unknown
delegations remain unresolved; no replacement or no-effect fence exists. Compiler
source research identified TypeScript's single-threaded option and ruled out the
unselected parallel-plugin path, but aggregate compiler concurrency remains
unqualified. All Mini, activation and integration-owner holds remain in force.

On successor `484b5c14`, Foundation passed build/typecheck and 3488 root tests;
three assertions failed across two files. Social, CLI with synthetic real-Planner
E2E, Planner and Design inventory passed. Design batch still failed Imports markup,
two app type errors and preview egress. INT follows the retained Social label
`Changed since linked`, scopes the Work save indicator separately from its row,
normalizes request selection from JSON state, and keeps the test's bridged flag
literal. The Imports test checks the typed alert and complete original failure
detail. Token copying is injected by the production composition instead of reading
the host inside the preview graph; the egress oracle is unchanged. All corrections
await a new full required CI run; native qualification remains unrun.

At `17f1d05c`, hosted Foundation's build and full root Vitest step passed. Wiki
reported one stale header expectation (`index rules v1` versus the accepted v2
contract); its source assertion now follows v2. Design's remaining type error was
an incomplete fake object relabelled as bridged. The fixture now composes the real
bridged workspace over the existing in-memory transport and replaces only its
explicit synthetic picker. Required discovery remains unchanged; later steps
blocked by these failures still need execution on the next head.

Exact private origin-record reads and independent installed-source review now
resolve both unknown requests as reservation rejected / never remotely launched.
The existing rejected receipts prevent ordinary replay and startup recovery from
dispatching them; there are no task/admission handles. Pending journal rows remain
unchanged and no new native fence was created. This disposition applies to the
exact original keys, intact records and inspected installed behavior. Current
receiving run/root ownership predicates were verified separately. Original retries
are stopped; the Wiki UI successor has a new task key and source-only worktree.
The unused Mini heavy allocation was returned to the updater, which accepted it
for one separately approved attempt. HQ verification waits for its explicit
process/EOF/lock closure and slot return, plus qualified compiler controls.

The updater has now returned the Mini heavy slot after its single attempt ended
nonpass before native birth. It reported closure of the actually started signing
and controller processes/groups and both output streams, an independent lock
reacquire/release and clean source. Its failed native-custody field remains in
the immutable receipt; the separate closure establishes only those actual
processes, not native acceptance. HQ has started no heavy work. The remaining
verification prerequisite is the ordinary compiler controller's aggregate bound
and fresh host admission, rather than either original delegation uncertainty.

At `16e9b028`, Foundation's complete required job passes, as do Social, Planner,
CLI with synthetic real-Planner E2E and Design inventory. Design's app section
still reports four composition failures: workspace feed identity, fake retry
revision, disabled Imports identity and lost-read fault injection. A bounded
source successor owns their diagnosis and repair without weakening discovery.

Wiki successor `87dbb4b4` is composed through an ordinary merge after a clean
conflict preflight. It preserves both retained screen ancestries and the current
setup/reference contracts. INT applies its exact optional shell-toast injection;
the mount otherwise remains current. Home, search, topics, reader/backlinks,
session history and keyboard source are present, with new behavior tests still
unrun. The next required CI must qualify this assembled source; native layout,
accessibility, persistence and reference-return evidence remain outstanding.

At `61eccd73`, Social remains green. Foundation reports two Wiki composition
failures: a global Wiki-button query now matches the new header, and the new Home
requests topics before setup classification. INT scopes the reference assertion to
Domains navigation and delays mounting content until setup answers. The original
two-status-read/no-content oracle stays intact, with a pending-status regression.

Design successor `12aea79d` isolates complete synthetic stores/caches and their
feed per workspace, preserving the original independence assertions and fake
retry no-op. Its fault seams were correct: both remaining Imports failures came
from public refresh retaining idle status. INT exposes a failed explicit read as
error while retaining the separate quiet post-write refresh. A pending unknown
write keeps its immutable Check target and checkable unknown notice; a new
lost-commit/read-loss/Check regression asserts no second commit. These changes
remain source-only until required CI executes them.

The ordinary Mini launcher now has a source-bound direct native TypeScript
subset with one compiler job and six serial commands. Full Vite/Vitest execution
is refused because worker teardown and native runtime recreation still lack a
proved aggregate bound. A separate serial mechanics task may execute only its
synthetic controller regressions in private scratch; it may not use the shared
compiler lock, run HQ compilers/tests, install dependencies or launch the app.
This is controller qualification, not the foundation baseline or assembled-head
acceptance. The existing native and integration-owner holds remain.

At `21059e1f`, Design's app section reaches one failure: its old selection test
requires the composed fake functions to be the legacy global functions, contrary
to the repaired workspace store/feed isolation. INT replaces that identity oracle
with the same API and fake-label checks, workspace-local function/store ownership,
same-workspace content memoization and zero calls to an available native
transport. The durable failure/no-fallback cases remain unchanged. The next CI
run must qualify this source correction.

At `ef1d0395`, Foundation build and root Vitest pass. The following Wiki Node
step reports three failed tests and a file cancellation with an unresolved
promise; its portable fixture stage is not reached. Design inventory, typecheck
and Node app tests pass, exposing three view-test failures. Social, Planner and
CLI with real synthetic Planner E2E remain green. Native/package jobs stay held
and skipped, without acceptance evidence.

Wiki checkpoint `f6746f5f` is composed after a clean merge preflight. Its reader
oracle admits exactly page, backlink and two intended chrome-status reads, with
exact arguments; stale-search assertions use accepted heading and filter chips,
retaining response-order and namespace checks. The keyboard fixture restores its
fake clock before teardown and guarantees cleanup on an assertion failure. The
exact unresolved await is not yet established; this source candidate must pass
all keyboard cases before the cancellation can be called corrected. No timeout,
retry, skip or assertion weakening is introduced. The separate Design repair
continues against its three observed failures.

A production-Vite source proof now bounds one invocation to six simultaneous
compiler domains under explicit per-pool controls and a fresh six-job budget.
The private build-only controller extends the serial TypeScript subset with this
route. Its source hashes are verified; process/input-custody review and executable
mechanics qualification remain pending. This is not a qualified launcher or a
build result. Full Vitest lifetime bounds remain separate and unproved. No HQ
compiler, build, local test service or native producer has started.

Contributing conversations and roles, with native identifiers retained privately:

- Resume HQ User Flows and Backend Buildout: receiving continuity, shared integration and delivery coordinator.
- Complete HQ User Flows and Backend: origin recovery, accepted plan fan-in, retained baseline reconciliation.
- Accepted Fable planning and Astra concept-review sessions: initial recovery plan and independent architecture review, reconciled in the original planner session.
- HQ source-capsule builders: shell, Work, Social, Design, Wiki contracts/validation, Settings, tooling and acceptance source; their revision-bound receipts are listed above.
- HQ Work queue correctness and fix-scoped re-review: two selected P1 dispositions; native fixture review and re-review: four selected scenario P1s.
- HQ run ownership and pending delegate reconciliation investigation: installed-source investigation; no runtime reconciliation or effect fence proved.

Referenced historical context: HQ User Flows and Backend Buildout and its twelve saved lane handoffs. The App Installation and Background Updates conversation supplies resource custody/closure evidence and a separate source-overlap boundary; its installation authority is not transferred here. Public artifacts omit native conversation/session identifiers and private operation details.
