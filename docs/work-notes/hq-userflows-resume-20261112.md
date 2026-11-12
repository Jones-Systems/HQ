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

## Execution ledger

Planning task `hq-recovery-fable-framing-20261112-r1` uses verified Fable 5.2/high on the account selected by the account-routing helper. It reads this coordinator tree only; the parent retains sole Git ownership. Mini readiness task `hq-recovery-mini-readiness-20261112-r1` uses Sol/high in its own app-bound worktree on `work/hq-recovery-mini-readiness-20261112`, read-only except its own Git fetch/currentness operations. Neither task builds, tests or edits source. Their exact native handles remain in the parent task ledger.

Independent concept review will use Astra/xhigh, and building Sol at the mode-selected effort. Children get explicit writer cones and isolated worktrees; no recursive delegation unless assigned. Build and test execution stays on the Mini, with fresh resource admission and serial descendants. The first Mini sample admitted two starts with normal pressure, zero observed swap activity and 14.7% CPU; the laptop sample admitted two starts with warning pressure and 40.7% CPU. These samples are historical evidence, not future reservations.

Bounded task `hq-recovery-social-diagnosis-20261112-r1` uses Astra/xhigh for the one baseline Social concurrency failure. It reads this coordinator tree without writes, builds or tests. This task is independent of the framing result and returns a repair capsule for later Mini execution. The admission sample allowed two starts (warning pressure, 49.2% CPU; one core 8.33%).

## Next actions

Recover current lane state and unresolved decisions; obtain the Frontier Max planning contribution; perform its independent architecture review; encode the accepted bounded lanes and run them to source completion, verification and policy-covered delivery. Preserve explicit failed, missing, held and unknown evidence in this record.

## Acceptance evidence to recover

The existing F7 assessment and campaign specs require first-run orientation and reopenable onboarding; domain navigation and remembered destinations; a global command palette with the existing Design shortcut ownership respected; consistent observed service status; inline Social/Wiki failure states; readable cross-domain references and a working return route; narrow-window and keyboard journeys; reduced-motion behavior; and light/dark/system appearance. The Work and Social screen families must match their established mockups and remain functional with real local services or explicitly labelled synthetic fixtures. Design and Wiki completion includes their backend and reference contracts, not screen presence alone.

Final evidence must bind to one assembled source head and its fresh Mini build. The native runner's checkpoint is only a prerequisite; selected/full modes retain their explicit missing or held journeys. Synthetic and fixture checks never prove private-data or live-provider qualification. No source build, test or app launch has run in this recovery yet.

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
