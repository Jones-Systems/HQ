# HQ updater qualification

Artifact Type: acceptance-record
Artifact ID: acceptance.hq-updater-source-20261112
Purpose: Record the package compatibility repair and distinguish portable source evidence from native and operational acceptance.
Consumers: HQ updater maintainer and integration owner
Authority effect: none

## Source and integration boundary

The receiving source is foundation `8945d156585510fbdf1515fad01798f416146b4e`.
[Updater #141](https://github.com/Jones-Systems/HQ/pull/141) includes
[signing #142](https://github.com/Jones-Systems/HQ/pull/142); signing merge
`ed7af03c3be21a909bf1a0e7cc1464308724dcec` is an ancestor of this foundation.
The separate [foundation-to-main PR #2](https://github.com/Jones-Systems/HQ/pull/2)
retains its combined-runtime acceptance hold. This repair targets foundation;
it neither promotes that branch to main nor accepts other product lanes.

## Compatibility repair and evidence

At the receiving source, `node tools/updater/packaging/compatibility.cjs`
refused four unregistered persistence references. Reviewing the registered
sources also found five changed store fingerprints since registry revision
`f7f84e104ae1db90492513014faa3942db2437a4`:

- Wiki now refreshes indexes in background generations and bounds snapshot retention.
- Sources includes immutable generations, binding custody and retained-byte storage.
- Design includes enabled storage construction, import routes, the Taste journal and refreshed Compare versions.
- The service contract includes import and source-generation routes.
- Renderer persistence moved from `App.tsx` into `PresentationShell.tsx`.

The registry now includes `PresentationShell.tsx` among profile writers.
The browser preview's `environment.ts` installs memory-backed local/session
storage before `main.ts` imports and invokes `mount.tsx`; the preview build
script writes its explicit artifact directory. Those three files are registered
with that non-profile ownership explanation. No discovery exclusion or
compatibility guard was relaxed.

Reviewed store fingerprints produce the new epoch
`hq1-8f6fcfeb0959d23a6e113502e48d9a78c2eb896d432375c042e369813fc3717c`
with 143 registered sources. This deliberately refuses an ordinary update
across the previous epoch. It does not establish a migration or compatibility
with a previously installed profile. A later foundation change must pass the
same source inventory and fingerprint checks again.

Portable verification on Node **24.19.0** passed all **139** updater/package
tests, with **zero failures, cancellations or skips**, after the registry repair:

```sh
node --test --test-concurrency=1 tools/updater/test/*.test.cjs tools/updater/packaging/test/*.test.cjs
node tools/updater/packaging/compatibility.cjs
git diff --check
```

The first command covers installer/bootstrap, journal interruption, exact
process leases, binary recovery, profile-write preservation, signed-policy
refusals, package layout and the synthetic native scenario plan. Its native
adapters are synthetic. It does not execute macOS installation or prove a
cryptographic signature. Root renderer compilation and full source discovery
remain the receiving PR's required CI obligations.

## Native acceptance still required

The previous [ARM64 native package job](https://github.com/Jones-Systems/HQ/actions/runs/39981843129/job/120510857410)
failed at process-inventory `path-before`, errno 2, zero path result and
`same-live`. This did not prove a process was safe to omit. Production inventory
admission and the unknown-process cleanup fence remain unchanged. The earlier
unqualified artifacts and retained scratch are not adopted or removed here.

The next permitted native step is an allocated Apple Silicon inventory preflight
using this candidate's unchanged `process-inventory.c` and `native.cjs` parser.
Bind exact source and helper hashes, one owned build/output directory, a shared
serial compiler lock, fresh same-host CPU/memory and filesystem admission,
bounded compilation/execution, and exact cleanup ownership before starting.
Publish only `complete`/count or the adapter's closed `inventoryFailure` record;
never publish raw process inventory. Missing evidence holds with zero app launches.

Only complete inventory admits the packaged synthetic journey matrix in
[`native-smoke.cjs`](native-smoke.cjs): fresh install, first health, exact
next-launch scheduling, retained prior identity, interrupted-stage recovery,
failed-health binary restoration and preserved synthetic profile writes.
[`native-storage.cjs`](native-storage.cjs) measures the receiving filesystem
before ten bundle copies plus its documented allowance and reserve. Bind the
exact archive/source/architecture, isolated bundle identity and empty synthetic
profile; verify all owned processes drained and scratch cleanup completed.
An unknown process result retains scratch and stops the run. No installed HQ
profile or running application participates. Intel qualification is not a
completion requirement.

## Three-app signing and permission continuity

**HQ source:** #142's policy is present on foundation.
[`signing.cjs`](../signing.cjs) fixes Team `2CUPSQS986` and identifier
`org.jones-systems.hq.local`; [`developer-id.cjs`](developer-id.cjs) and the
package workflow require explicit activation and trusted canonical main.
Portable tests exercise stable requirements, no ad-hoc fallback, notarization
failure handling, provenance and compatible signed binary rollback. They do
not prove a real signed release. HQ still needs integration-owner acceptance,
native inventory/journeys, protected-environment enrollment and review, an
authorized signed/notarized/stapled artifact, and measured update/rollback
continuity. Legacy adoption additionally needs exact old source hashes,
retained binary, safe departure and the externally supplied profile pins.
The old quit/unsaved-work problem is not solved by updater scheduling.

**Jones Code source:** [#546](https://github.com/Jones-Systems/Jones-Code/pull/546)
merged as `5e32fa0175ec0abe42f36b7fc00da0ca865e2f98`.
Its [signing guide at that merge](https://github.com/Jones-Systems/Jones-Code/blob/5e32fa0175ec0abe42f36b7fc00da0ca865e2f98/docs/operations/macos-signing.md)
defines production `com.jonessystems.jonescode`, protected main-only signing,
stable component requirements, signed-update refusal and retained rollback
checks. Baseline signing and optional browser-passkey capability are separate.
Enrollment/activation state is not inferred from source. Real signed artifact
acceptance, authorized legacy-identity bootstrap, actual app/child synthetic
resource access and continuity across signed update/compatible rollback remain
separate proofs. Existing installed Jones apps and services are outside this
qualification. The ChatGPT helper attribution/policy remains unresolved here.

**CodexBar Jones source:** [#26](https://github.com/Jones-Systems/CodexBar/pull/26)
merged as `c314d5b6a30ef9c4888ccb120d35150fa545e61c`.
Its [identity contract](https://github.com/Jones-Systems/CodexBar/blob/c314d5b6a30ef9c4888ccb120d35150fa545e61c/docs/jones/IDENTITY.md)
and [protected signing workflow](https://github.com/Jones-Systems/CodexBar/blob/c314d5b6a30ef9c4888ccb120d35150fa545e61c/.github/workflows/jones-macos-signing.yml)
separate Jones identity/state from upstream and guard signing behind canonical
main and explicit activation. #47 qualification belongs to its independent
delivery lane. Signed delivery still needs its exact app/widget app-group and
iCloud profile/capability prerequisites, trusted updater metadata, authorized
bootstrap and actual state/permission continuity. Source metadata is not
evidence that protected profiles or grants exist.

Across all three apps, the completed backup-custody handoff is preserved;
no protected store was reopened or key re-exported for this record. Certificate
and notary enrollment, environment activation, release publication, installation,
owner consent and continuity tests remain distinct operations. The acceptance
sequence is: qualify exact signed identity/seal/notary/provenance; reject
tampered/wrong-team/wrong-ID candidates before swap; bind narrowly authorized
synthetic resources to the actual app/child context; then prove relaunch,
changed-CDHash signed update and compatible signed rollback preserve access
and state. Do not read TCC databases or change permissions to manufacture proof.
