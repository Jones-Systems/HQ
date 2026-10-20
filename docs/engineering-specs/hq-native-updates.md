# HQ native distribution and explicit updates

<!-- codex-section:begin id="spec.hq-native-updates#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-native-updates`

Purpose: Prepare native HQ distribution, profile-preserving adoption and explicit in-app updates.

Governing artifact: `spec.hq-integration-parallel-execution`

Specification owner: HQ updater follow-on

Integration owner: HQ integration coordinator (T1), with shared runtime custody retained by T2

Consumers: Shared desktop owner, platform build owner, acceptance owner and installation operator

Authority effect: none
<!-- codex-section:end id="spec.hq-native-updates#ctx.artifact-header.001" -->

## Project summary

HQ needs qualified native binaries and an in-app path to see the installed build,
check for an update, observe preparation, and explicitly accept installation and
restart. Local data must survive adoption and updates, with recovery available
even when the new UI cannot start. Source, successful checks, a built binary,
a published release and an installed runtime are separate outcomes.

This is a preparation checkpoint. It defines requirements, evidence needs and
ownership boundaries, not an accepted wire format or a runnable updater plan.
Contract-coupled implementation waits for the existing install-flow work's stable
interface and HQ's shared-file custody agreement through [coordination issue #50](https://github.com/Jones-Systems/HQ/issues/50).
There is no replacement updater implementation in this change.

**Implementation stage:** this PR adds one specification document. It supplies no
packager, distributable HQ binary, update feed, in-app update control, install
transaction or recovery executable. The local native testing route exercises the
existing application; it is not an installer. Passing repository checks on this
PR establish source compatibility, not any of the updater test intents below.
Accepting this document would integrate the preparation only.

macOS arm64 is the existing installation target. Linux x64 is the demonstrated
native test platform and a distribution qualification candidate; its binary and
update mechanism still need qualification. Other platforms and architectures
remain unqualified. Linux execution cannot establish macOS installation behavior.

<!-- codex-section:begin id="spec.hq-native-updates#req.product.001" -->
## Requirements and proof

| ID | Required behavior | Required evidence |
| --- | --- | --- |
| UPD-R1 | Stable HQ display, bundle/application and profile identities; no silent profile fork | Identity readback, package inspection and seeded upgrade |
| UPD-R2 | Native artifact matches the selected platform and architecture; macOS arm64 built on a valid macOS route | Exact-source build receipt and native launch |
| UPD-R3 | Offer binds trusted repository/channel, commit, tree, successful checks and artifact integrity | Negative provenance tests and independently authenticated build evidence |
| UPD-R4 | Show installed version/build, availability, preparation progress, errors and recovery | Native UI scenarios with synthetic feeds |
| UPD-R5 | Replacement and restart require the owner's explicit acceptance of one exact candidate | Lifecycle tests, including ordinary quit/relaunch before acceptance |
| UPD-R6 | Preserve durable main-process and Chromium profile state, without borrowing a personal profile in tests | Seeded old/new package round trip on each qualified platform |
| UPD-R7 | Recover from interruption without ambiguous retries or data loss | Fault injection and recovery without the new UI |
| UPD-R8 | No embedded repository credentials, renderer secrets or arbitrary executable/download targets | Closed-interface and package-content checks |
| UPD-R9 | Keep sandbox, context isolation, CSP, sender validation and remote-work independence | Affected security and native tests |
| UPD-R10 | Declare signing/notarization status honestly; qualify unsigned-development adoption separately | Native signature, quarantine and adoption evidence |
| UPD-R11 | Run assignment testing on the existing VPS; retain evidence locally | Local receipts; no added workflows, runners, dispatches or artifact uploads |
| UPD-R12 | Support a small, explicit adoption step from the existing unsigned development app | Exact-head macOS migration rehearsal before any owner-profile operation |
<!-- codex-section:end id="spec.hq-native-updates#req.product.001" -->

## Research and decision basis

Repository observations are bound to `214c884319cd4783da266fcc6124112f59cdd2db`,
tree `a8bf91c367fd548efc935d1d4d1b9a9f38f4b761`, containing merged [UI PR #114](https://github.com/Jones-Systems/HQ/pull/114).
At intake [foundation PR #2](https://github.com/Jones-Systems/HQ/pull/2) remained draft with
25 successful checks at that head; `main` remained `bc8202a9731d51922c7cddde91f6ada0074adc1d`.
These observations do not select an eventual release build: refresh source,
integration acceptance and checks when constructing that candidate.

Currentness refresh: foundation advanced to
`3e76fb24d35ac9883f2da0e3b0ab26d47f8cf116`, tree
`fb8c0081d8957bd8650c9f24490739e5e6dcdf7b`, through merged
[settings/calendar/reference refinement PR #116](https://github.com/Jones-Systems/HQ/pull/116).
This task branch incorporates that foundation through a normal merge. The new
base changes renderer/domain UI and tests; manifests, lockfile, Electron main and
preload, contracts and workflows are unchanged from the original observation.
No packaging/updater source, published release or Actions artifact appeared in
the refresh. The earlier native evidence remains bound to `214c884...`; it is not
a native test of the refreshed branch. The separate install-flow dependency's
latest result is still a research recommendation, not a delivered reusable
interface, so its implementation prerequisite remains open.

- Root and desktop manifests have no packaging/updater configuration. The desktop
  version is `0.1.0`; the current desktop metadata port exposes platform and
  Electron version, not HQ build provenance.
- Release and Actions artifact inventories were empty. Existing workflows use
  standard `ubuntu-24.04` runners, skip Electron download and upload no artifacts.
  Existing default PR checks may run on publication; this assignment adds no CI.
  [GitHub's billing guidance](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  distinguishes free standard public-repository compute from other charges.
- `apps/desktop/electron/main.ts` uses `app.getPath('userData')`, a single-instance
  lock, a `file:` renderer and asynchronous Design/Wiki close handling. Its
  `HQ_USER_DATA_DIR` override is limited to unpackaged runs.
- `modules/social/workbench/Catalog.tsx` and `catalog.ts`, with extensionless
  imports, remain a known case-insensitive macOS build-resolution issue. Its
  existing owner must resolve it in source before that build is qualified.

Primary-source constraints, checked during preparation:

- [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)
  recommends Forge and also documents manual packaging. Packaging alone supplies
  neither signing nor qualification.
- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)
  supports macOS/Windows, requires signing on macOS and has no built-in Linux
  updater. Check calls can also initiate downloads, and downloaded updates can be
  applied on the next launch. The update quit path closes windows before the
  ordinary `before-quit` handler; its earlier update event is not evidence of an
  awaitable drain barrier.
- [Electron update guidance](https://www.electronjs.org/docs/latest/tutorial/updates)
  uses platform-specific release metadata. [Signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing)
  treats macOS signing and notarization as separate release steps.

Consequently, adopting a library is conditional on proving UPD-R5 and HQ's close
ordering, not simply connecting a feed. Signing strategy, release transport and
Linux distribution format remain open. No permanently unsigned strategy,
custom swap helper, shared library or new hosted build job is selected here.

Consumer coverage is **partial** for the named HQ source revision: inspected
manifests, main/preload/contracts, shell persistence, Design/Wiki host close paths,
native harness documentation and workflows using direct source/reference search.
Graph navigation had no HQ snapshot. Installed profile contents, packaged origin
behavior, every domain's unsaved-state lifecycle and platform replacement helpers
are excluded and need separate evidence. No private data or external live service
was inspected.

<!-- codex-section:begin id="spec.hq-native-updates#iface.preparation.001" -->
## Interface requirements awaiting agreement

These are semantic requirements, not frozen field names or a reusable schema.
The install-flow dependency must identify its accepted revision, owner and
reuse boundary, or explicitly confirm which concepts HQ should implement itself:

1. Candidate/provenance representation and authentication: repository, channel,
   exact commit/tree, version ordering, platform/architecture, artifact size and
   digest, lockfile/toolchain identity, build/check subjects, qualification and
   signing status. A mutable branch or successful check on another commit is
   insufficient. A digest from the same untrusted feed does not authenticate it.
2. Preparation and operation identity: one replaceable unaccepted target;
   explicit acceptance binds an immutable candidate and operation identifier.
   A newer build cannot change an accepted operation. Duplicate actions and a
   lost response reconcile that operation before any retry.
3. Observable lifecycle: available, preparing, verified, accepted, draining,
   activating, committed, failed, recovery-needed and recovered meanings; durable
   journal ownership, reconnect/relaunch readback and terminal evidence.
4. Commit/recovery semantics: exact last-old-writer/first-new-writer boundary,
   crash points, snapshot coverage, independent recovery entry and the point
   after which reverting would discard newly written state.
5. Any reusable package's source/licensing, release identity, compatibility and
   HQ pinning method. No private implementation files are imported by this spec.

HQ-specific invariants apply regardless of the eventual shared interface:

- Version checking, preparation and installation are distinguishable actions.
  A download or ordinary relaunch must not imply install acceptance. The chosen
  platform mechanism must prove it can enforce that rule.
- Preparation may coalesce candidates while the old app keeps working. Automatic
  checking/downloading preferences and cadence need a visible, bounded policy;
  no background activation is inferred from an idle window.
- Main owns trust checks, candidate selection, journal and native effects. A
  narrow preload port exposes status and bounded actions; the renderer supplies
  no arbitrary URL, path, shell command or executable. Browser mode reports the
  capability unavailable. Ports and state names await T2 agreement.
- Quiescence is an activation precondition: settle admitted writes, account for
  unsaved editors and exclusive operations, handle dialogs and prove the old
  process has exited. A drain failure blocks installation.
- The final recoverable profile snapshot follows the last old writer and precedes
  the new app's first write. A preparation-time copy alone is insufficient.
  Before admitting normal new-version use, prove startup and profile health and
  record commitment. Recovery after commitment needs a separately defined policy
  that preserves subsequent writes; do not silently restore an older snapshot.
- Do not infer HQ database, provider, server-fleet or version-ceiling requirements
  from another product's update architecture. HQ's remote jobs remain independent
  of its UI lifetime.
<!-- codex-section:end id="spec.hq-native-updates#iface.preparation.001" -->

## Profile preservation and development-app adoption

The existing installation is reported as HQ `0.1.0`, macOS arm64, bundle
`org.jones-systems.hq.local`, unsigned development packaging. Preserve that identity
by default; any change requires an explicit migration design. Its effective
profile path and bootstrap behavior have not been read back by this lane. Do not
infer them from the bundle name, a new manifest or a conventional directory.

The inventory required for a synthetic preservation test includes:

| State owner | Source-observed durable state | Qualification consequence |
| --- | --- | --- |
| Electron main | `service-config.json`, `design-catalog.json` | Preserve configuration and explicitly reconcile uncertain writes |
| Design host/store | `design-store/`, recovery/transactions and data blobs | Drain active operations; test first-open recovery and restoration |
| Wiki runtime | `wiki/config.json`, `wiki/index-v1/` | First open can initialize/upgrade state; no write-free startup assumption |
| Chromium renderer | Appearance, rail/navigation, domain storage and origin/partition-dependent stores | Seed real stores; test actual package paths/origins across adoption |
| Domain sessions | Potentially unsaved editors and unresolved mutation intent | Identify ephemeral state and block/warn before owner accepts restart |

This inventory is not a license to read a personal profile. Determine every
store through source and synthetic experiments, including any IndexedDB/session
stores actually used. Do not assume `file:` persistence survives moving the
application, or that changing protocols/partitions preserves access to data.

Minimum macOS adoption preparation, through a separately authorized route:

1. Record exact existing bundle/executable identity, signature/quarantine state,
   install location and effective profile selection without launching or
   restarting the active app or reading profile contents. If effective selection
   cannot be proved noninteractively, leave it unknown until a scheduled owner
   action permits readback; do not search unrelated profiles.
2. Resolve the case-collision source issue and qualify a macOS arm64 build route
   at the chosen source/lockfile, with task-owned outputs and no GUI interference.
   No hosted macOS job or Mac SSH build is dispatched under this checkpoint.
3. Rehearse old-to-new adoption on a synthetic profile and a separate installation
   path, including signature transitions, origin preservation and failed startup.
   Prove packaged test isolation first; the unpackaged environment override is
   not a packaged-profile guarantee.
4. Prepare a reviewable, bounded adoption operation: owner chooses when to quit,
   final stopped-profile snapshot, verified native bundle replacement, relaunch,
   identity/data readback and a recovery command independent of the new app.
   Package/signing, release publication and live installation retain their exact
   owner/native authorization gates. The smallest one-time adoption action can
   only be finalized after this rehearsal; no runnable personal-profile command
   is supplied prematurely.

Gatekeeper behavior, signature continuity, notarization and quarantine effects
need native evidence. Do not remove quarantine, rely on an absent attribute or
disable OS trust checks to make a candidate run.

## Exact change surface and custody

This checkpoint owns only `docs/engineering-specs/hq-native-updates.md`. Private
continuity, diagnostic scripts and evidence remain outside published source.
It changes no manifests, lockfiles, workflows, harness, IPC or application code.

T1 retains integration refs, shared plan/check catalog and merge acceptance.
T2 retains root packaging/configuration, `apps/desktop/**` and
`packages/contracts/**` under the existing campaign. The Social owner retains
the case-resolution repair; the acceptance owner retains `tests/acceptance/**`.
The modernization source already integrated through PR #114 is preserved.

Before implementation, T1/T2 must bind literal paths and one Git owner for
identity/profile selection, packaging, main lifecycle/journal, preload contract,
UI states and native acceptance scenarios. The future dependency graph is:

1. Stable install-flow interface and custody agreement.
2. Identity/profile preservation plus native packaging at an accepted current
   source; trust/version/candidate validation against the settled interface.
3. Explicit activation, drain/snapshot/recovery integration, then its UI through
   the agreed port. Independent pure validation can proceed only once its format
   is stable; overlapping main/preload work remains serialized.
4. Native fault/recovery qualification and platform adoption rehearsal.
5. Separately approved signing/publication and owner-initiated installation.

These are ordering constraints, not released worker assignments. Signature/key
custody and product channel policy remain decisions for a concrete reviewed
candidate. No new review panel or automated reviewer service is required here.

<!-- codex-section:begin id="spec.hq-native-updates#test.qualification.001" -->
## Test plan and failure acceptance

Every result binds source/patch identity, build hashes, runtime platform/arch,
fixture, action/readback and cleanup. Keep artifacts on the existing VPS. Tests
use task-owned synthetic profiles/services; profiles and processes have teardown
on success, failure and handled cancellation. No private Wiki corpus or live
provider is part of this work.

| Test intent | Minimum observable acceptance | Required route |
| --- | --- | --- |
| UPD-T1 provenance | Reject wrong product/channel/platform/arch, mismatched subject/checks, unknown record version, tampering, downgrade and untrusted URLs | Pure validation plus fake-feed integration |
| UPD-T2 preparation | Offline/slow/malformed feed, insufficient space and interrupted download leave old app usable; bounded progress/errors; superseding affects only unaccepted target | Local unit/integration and native UI |
| UPD-T3 owner acceptance | Download then ordinary quit/relaunch cannot activate; double-click is one operation; acceptance binds exact candidate; unknown effect is reconciled | Native lifecycle, including chosen platform updater |
| UPD-T4 drain | Active writes, dirty editors, exclusive import/export and dialogs block or finish safely before stop; drain failure prevents swap | Synthetic native scenarios |
| UPD-T5 preservation | Seed all discovered stores in old build; adopt new actual package/path; verify data, settings and origins; no personal profile touched | Linux qualification and separate macOS arm64 rehearsal |
| UPD-T6 crash recovery | Interrupt verify, stop, snapshot, replacement, first launch and commit; recover deterministically or report unknown without retry; never overwrite post-commit writes | Linux simulations labelled as such; actual platform transaction tests |
| UPD-T7 platform trust | Match architecture/build identity, signing/notarization policy, writable supported install location and signature transition | Native macOS; separate Linux format qualification |
| UPD-T8 renderer/security | Correct availability/progress/error/recovery; browser unavailable; no generic IPC/URL/path, renderer credentials or sandbox regression | Affected unit/security groups plus native screenshots |
| UPD-T9 independent recovery | Restore an interrupted pre-commit adoption without starting the candidate UI and verify restored identity/data | Native platform recovery rehearsal |

No updater test intent above is claimed passing by the baseline below.
<!-- codex-section:end id="spec.hq-native-updates#test.qualification.001" -->

## Historical native baseline evidence

At clean source `214c884319cd4783da266fcc6124112f59cdd2db`, pinned Node `24.19.0`,
npm `11.17.0`, Electron `44.9.0`:

- Locked install, production build and all seven native fixture/cleanup tests
  passed. Lockfile SHA-256 remained
  `9f710b4af1640207468cfdf320d907d9b1aa7e4961ff78eed9eb20c09d7276c5`.
- The pre-existing local visual supplement reached all four domains and four
  Design sections, then failed at an obsolete appearance-dropdown selector after
  the UI modernization. Cleanup passed; this failed result is retained.
- A task-local diagnostic changed only the appearance interaction to the current
  cycling button, preserving the supplied isolation/teardown. It passed four
  domain mounts, Requests/Runs/Resources/References navigation, light/dark/system
  behavior with emulated media changes, and actual process exit/relaunch with
  persisted appearance/navigation. Thirteen captures are each 1280 by 795 pixels;
  device scale was not separately measured. Cleanup passed.
- That diagnostic's SHA-256 is
  `90d72ef63c6d82cbc678de4ad8fe4f17063222f2115ca0e8817713c69d901e4a`.
  Both runs used the immediately preceding build, with identical entry hashes:
  renderer HTML `41b4b2c30b14a7d7b454f92a6f440c4e0bca261db6a298fe44e5d1703a96c9f3`,
  main JS `4d3b63e78e9b916f82521ad1dfaa9f0dae04e83f5dc81548ec70fce4b28af2e9`,
  preload `9d75ea94f3ba8c74f8c05dfe547a102f551ea854ef67e79685614e12f208b4b1`.

The diagnostic is retained locally and is not a committed harness extension or
an installed helper repair. Public source alone does not reproduce that local
scenario. Its services/corpus were synthetic even when product chrome said live.
This proves bounded unpackaged Linux shell behavior, not signed packages,
updating, live services, complete feature acceptance or macOS fidelity. The twelve
previously recorded integration/qualification gaps remain unqualified here;
full-mode acceptance was not rerun or relabelled as passing.

## Stop, recovery and delivery boundaries

Deliver this preparation as a draft checkpoint against the verified foundation,
with issue #50 tracking the interface/custody prerequisites. Merge remains held
for integration-owner agreement. Do not poll the dependency, create a timer,
request duplicate status or start a competing implementation. Resume the held
source slice only when the actual settled interface and custody are available.

No signing/notarization credentials, release publication, app installation,
profile access, service/provider activation, elevated operation or Jones Code
restart/update is authorized by this document. No Mac GUI control is involved.
Retain task evidence and the owned worktree for continuation; no branch/worktree
deletion or shared scratch cleanup is implied. Source readiness, green checks,
published binaries and installed runtime must be reported independently.
