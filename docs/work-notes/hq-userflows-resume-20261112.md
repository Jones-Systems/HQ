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

The native goal is paused. A second owner-started continuation requested coordination transfer. This thread starts no new implementation or verification lanes while paused. Existing delegated task ownership and unknown effects remain here until explicitly serviced; a native handoff offers continuity, not task-management rights or merge authority.

The Fable initial plan, independent Astra concept review and a verified continuation in the original Fable session are complete. The reconciled plan accepts the review corrections: restore B4 tooling, B5 validation and missing native-journey source; preserve all Design ports; assign one writer per shared file; reuse the existing Darwin runner; allow one serial test process total on the Mini. The native handoff carries the complete accepted plan for encoding as a recovery amendment to the existing progressive Engineering Spec. That encoding is not yet done.

### Source checkpoints

| Capsule | Branch | Pushed head | Evidence and remaining work |
| --- | --- | --- | --- |
| Social admission | `work/hq-recovery-social-burst-20261112` | `fa2728a9d8ed90abd7b6980c905d805fed5c96a0` | Exactly listener backlog plus two affected test files; AST/diff checks only. Controlled before/after, focused tests, full Social discovery and Ubuntu advisory CI unrun. |
| Work persistence spine | `work/hq-recovery-work-spine-20261112` | `cd1371e12182db9aaa09f7a7c809f8f07fd8f042` | Retains current foundation and #198 ancestry. Static-only checkpoint. Main-process construction/channel handler still requires coordinator integration. Offline queue and renderer wiring excluded. |
| Planner–Wiki compatibility | `work/hq-recovery-planner-wiki-20261112` | `a4d5e0c371c03fce0bd2e2de058ba429ff063f45` | Domain fields, coverage, vector copies and hashes ported onto current validation. All 52 old cases and 27 exchanges retained; 14 Wiki cases added. Static syntax/hash/copy checks only. Generator check, behavioral tests and real roundtrip unrun. |
| Shell/navigation | `work/hq-recovery-shell-20261112` | pending result | Existing source-only builder; owns retained shell/status/scope spine, kit, navigation/onboarding and shell mounts. |
| Wiki validation | `work/hq-recovery-wiki-validation-20261112` | pending result | Existing synthetic-only builder. Its prompt incorrectly spells the tool cone as `modules/wiki/scripts`; actual retained tool is under `modules/wiki/core/scripts`. Receiver must clarify that narrow grant before further tool edits. Correct retained tip is `352df74`; earlier prompt names ancestor `38fe4ea`. No `core/src`, UI or contract edits are required. |

No recovery PR has been opened. All runtime tests, builds and app launches remain unrun in this campaign. Source checkpoints are not accepted implementations.

### Remaining source work

The accepted flat capsules retain all twelve lanes: shell integration; Work main-process wiring, reviewed offline queue, health and five screen families; Social screens plus planned gated extension source; Design Taste/capabilities/export-port source, host matrix, six Sources views and main screens; Settings and Wiki views; additive Wiki contract; local checks/Darwin preview tooling; and four missing native acceptance scenarios. Generation, component execution, export enablement and live posting retain their gates. Optional review findings keep original severity and recorded disposition; they are not automatic repair assignments.

Design compose writers run capabilities → Sources → active-project/core views. Module builders consume the published shell checkpoint and report desktop wiring hunks to its one owner. Work queue consumes the Work-spine checkpoint and receives a correctness review before integration. Coordinator owns shared contracts, Electron main startup, workflows, root configuration and acceptance registration; exact overlaps with #209, #212 and the external storage/evidence stack require fresh reconciliation.

Product defaults remain: Plan week at `board/week` within the existing navigation order; Social and Work remain workspace-scoped; no Wiki revision history. Private-source authorization and old private scratch disposition remain unresolved and do not block synthetic source implementation.

### Mini verification admission

The updater campaign's HQ-A3 unsigned Phase B still owns the heavy slot. Its fulfilled allocation answer gives this source-verification lane the next slot only after A3 closure and reconciliation of the unknown baseline launch. Native/signing/main holds remain. No duplicate slot request or verifier is authorized by elapsed time.

Baseline launch request `hq-recovery-mini-baseline-20261112-r1` repeatedly returned “Remote delegation is durably pending reconciliation.” No task handle or child thread was returned. Reconcile the identical request in the owning parent context; never invent a handle, replay it as a new task or assume no effect. Exact input bytes and native evidence are carried in the handoff.

Fresh admission is required for each new batch. The last observed Mini CPU sample was 96.19%, with normal memory pressure and no swap traffic; it admitted zero starts/tests. B4 tooling was therefore NOT launched. Historical low-load samples do not reserve capacity.

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
