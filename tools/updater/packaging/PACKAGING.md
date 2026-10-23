# HQ package source

`package.cjs` runs on a matching native macOS runner after `npm run build`.
It copies the locked Electron 44.9.0 distribution, the desktop renderer,
Electron output including nested Design/Wiki hosts, updater runtime, and the
installed transitive runtime dependencies. It preserves `hq`, product name
`HQ`, bundle ID `org.jones-systems.hq.local`, and the
`Resources/app/local-bootstrap.cjs` entry. The package receipt and Info.plist
bind the exact clean source commit/tree, version, workflow run sequence,
channel, compatibility epoch, Electron version and architecture.

Before assembly, the native runner compiles `tools/updater/process-inventory.c`
with its macOS SDK Clang into `tools/updater/process-inventory`, using C11,
`-Wall -Wextra -Werror` and the exact target architecture. The generated
executable is required beside `native.cjs`; no binary is tracked in Git.
Packaging checks its architecture, signs it in the explicitly selected mode, and verifies it before
the complete bundle's strict deep signature check. Portable layout tests
inject fixture bytes with executable permissions and never run that fixture.

The ZIP contains only `HQ.app`, with framework symlinks preserved. Metrics use
the ZIP central directory: expanded bytes include symlink target bytes, and
entry count includes directories. Strict deep ad-hoc code verification is
package consistency evidence; it is not Developer ID or notarization evidence.
`INSTALL.txt` and the bundled-runtime launcher are shipped beside the archive
and inside its Resources directory. The launcher creates its own fresh
extraction of an independently authenticated archive, refuses an existing
target, and removes only its exact extraction after the installer exits.

## Developer ID production mode

Production keeps `org.jones-systems.hq.local`; it does not change the existing
profile, app name or installation target. `HQ_SIGNING_MODE=adhoc-development`
selects the existing development package path. `developer-id.cjs` is the only
production entry point. A missing identity, key, accepted notarization result,
timestamp, hardened runtime, expected Team ID or stapled ticket fails the job;
it never switches to ad-hoc signing. Stable-channel packaging also refuses
ad-hoc mode.

The whole production path is disabled unless the nonsecret repository variable
`HQ_SIGNED_RELEASES_ENABLED` is exactly `true`. An authorized operator enables
it only after source integration, protected-environment enrollment and native
qualification. Source publication does not set this variable. When it is absent
or false, ordinary PR checks and development tag releases retain their behavior.

After activation, a canonical `refs/heads/main` push runs unsigned qualification,
then the protected `developer-id` job. The repository's default branch must also
be `main`; a different default branch is a policy mismatch that stops signing.
The job checks out the exact workflow commit and builds before introducing
secrets. PRs, arbitrary branches and tags cannot enter it. Keep the
`macos-signing` environment limited to `main`; any required approval remains an
independent gate. Manual `workflow_dispatch` with `signing=developer-id` also
requires activation and the same trusted branch, but produces artifacts only.
Never temporarily trust a feature branch to exercise signing.

An authorized operator enrolls these **environment** secrets through a trusted
secret manager or GitHub's protected secret input, never through PR text:

- `MACOS_SIGNING_CERTIFICATE_P12_BASE64`: the Developer ID Application identity
  and private key in encrypted PKCS#12 form for Team `2CUPSQS986`.
- `MACOS_SIGNING_CERTIFICATE_PASSWORD`: its export password.
- `APPLE_NOTARY_API_KEY_P8_BASE64`: the notarization API private key.
- `APPLE_NOTARY_KEY_ID` and `APPLE_NOTARY_ISSUER_ID`: the matching public IDs.

The `.p12`, `.p8`, passwords and private keys must never be committed, pasted
into public issues, printed in logs, attached to artifacts or placed in process
arguments. The importer reads the P12 and password from its single-child
environment and calls Security.framework in process. It restores the exact
keychain search-list preimage on success and failure. A unique mode-0700 runner
directory contains the ephemeral keychain and mode-0600 notary key. The keychain
uses an intentionally empty, non-secret password and is never reused. Only
`codesign`/Apple tooling gets access; the login keychain is untouched. Secret
environment variables are removed before packaging subprocesses. Exact owned
scratch and the keychain are removed on normal success/failure; handled signals
remove owned scratch, and runner disposal contains an unhandleable termination.
Swift module caches stay in that same scratch root. Cleanup failure fails the
job; no directory glob or shared-parent deletion is used.

Nested Mach-O files and code bundles are signed inside out with deterministic
identifiers, the selected Developer ID certificate, secure timestamp and hardened
runtime. App/helper entitlements allow JIT only; no get-task-allow or disabled
library validation is requested. Strict verification tests the Apple Developer
ID certificate requirement and Team ID for each code item. The top-level
designated requirement must preserve identifier plus certificate identity,
without CDHash or an alternate `or` clause. The notarization upload ZIP is
removed after submission; only an `Accepted` result proceeds to stapling,
`stapler validate`, Gatekeeper assessment and a final strict signature check.
The final archive is created **after** stapling. Before creating the temporary
notary archive, storage admission budgets two bundle copies plus 1 GiB metadata
and a 2 GiB free-space reserve on the output filesystem.

The production job uploads a 14-day `hq-developer-id-<arch>` artifact containing
the final stapled app archive and package evidence. On a main push it also
creates `hq-darwin-<arch>.json`, binding `sourceRef: refs/heads/main`, the exact
source commit, workflow run/attempt and ZIP digest. The same run attests both
ZIP and manifest through the existing Sigstore action and assembles both
architectures for publication. Manual dispatch has no release manifest and
cannot enter attestation or publication.

A successful main push publishes one preview release named
`hq-desktop-signed-<runId>`. The publisher rechecks both manifests and archive
hashes, requires the tag and release to be absent, creates a lightweight tag at
the exact attested commit, then publishes without replacing assets. Direct
readback requires that tag commit and every uploaded asset's SHA-256/size to
match. A lost command response counts as success only when those full native
postconditions are observed. Existing tags/releases, partial publication,
mismatched tags or unknown responses stop without retries, replacement or
cleanup; an operator must reconcile that exact run. Re-running an already
published run cannot overwrite its assets.

The `hq-desktop-signed-` namespace is reserved. Tag-push jobs refuse it, preventing
a production tag from entering ad-hoc publication. Other tag pushes retain the
existing integrated-foundation guard and explicitly ad-hoc development output.
Updater verification selects fixed main-push provenance for Developer ID and
existing tag-push provenance for legacy development; a manifest cannot choose
another trusted branch, workflow or repository. Signed discovery also resolves
the release tag to the attested commit before preparation.

Production receipts add the closed optional `signingPolicy` object (version 1,
`developer-id`, Team `2CUPSQS986`, unchanged identifier, and required runtime,
timestamp, notarization and staple flags); manifests also use
`signing: developer-id`. Old receipts without that field still decode as
ad-hoc development. The policy is included in candidate identity, installed
records and retained rollback receipts. Native admission independently verifies
the actual signature, stable requirement, stapled ticket and Gatekeeper result.
Production installations cannot schedule an ad-hoc downgrade. The exact retained
pre-migration development bundle may still be restored under the existing
transaction's receipt/profile/provenance rules; this does not admit arbitrary
unsigned candidates. A consent grant remains a per-app, per-Mac owner action;
source tests do not establish TCC continuity.

Checks extend the existing `hq-updates-package`, `hq-updates-transaction` and
`hq-updates-discovery` groups in `tests/check-groups.toml`; the public shared
receipt type also selects `hq-updates-bridge`. Local synthetic tests use existing
unique fixture roots and teardown. The unsigned macOS job typechecks the native
credential importer without reading credentials. Actual signing, notarization,
production launch and consent continuity require a separately authorized trusted
run and remain unproved by mocked tests.

Sources: [Apple Developer ID](https://developer.apple.com/developer-id/),
[Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
and [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).

## Compatibility registry

`compatibility-registry.json` records Electron major, app/bundle identity,
userData/sessionData layout bindings and persisted storage owners. Store
source digests include their sorted relative file names and byte digests.
Changing a registered store without updating its record fails the guard.
Refreshing a store digest changes the derived `hq1-<sha256>` epoch, so a
potentially incompatible binary is not automatically exchanged or restored.
No profile migration is implemented here.

Main/bootstrap use selected profile-binding expressions plus persistence-entry
signals, rather than whole-file hashes: unrelated updater lifecycle edits do
not change the epoch. Actual store owners are conservatively hashed in full.
The inventory detects unregistered direct filesystem/browser-storage entry
points. It does not prove arbitrary indirect writes absent; a new profile
writer must be registered during source review, including its schema owners.
Non-profile source registrations require a reason and a checked source digest
but do not affect the profile epoch.

After reviewing source/schema changes, explicitly refresh the registry:

```sh
node tools/updater/packaging/compatibility.cjs --refresh-reviewed-registry
node tools/updater/packaging/compatibility.cjs
```

The refresh is a source change for review, never a CI repair step. CI executes
only the read-only guard. Changes to identity/layout interpretation require a
matching source update and direct compatibility tests, not an automatic
acceptance of new identity metadata.

## Checks and evidence

The group is `hq-updates-package` in `tests/check-groups.toml`:

```sh
node --test --test-concurrency=1 tools/updater/packaging/test/*.test.cjs
```

The workflow runs the transaction/installer tests, root build and desktop
tests serially, then packaging and `native-smoke.cjs`. Each expensive command
gets a fresh CPU/core/free-memory-lower-bound sample through `ci-run.cjs`.
CPU at or above 85% or missing evidence holds a new start. Compiler concurrency
is at most six and never exceeds the observed logical CPU count.
With valid evidence of a busy host, admission takes at most ten one-second
samples separated by five-second waits (55 seconds of scheduled waiting).
Missing evidence fails immediately. Only admission is resampled; a command
that has started is never retried by this wrapper.

Native smoke uses two independent installations of the synthetic package/app/
bundle identity, with separate owned profiles under one fresh scratch root.
Each installation initializes its state directory through the production state
API before placing candidates inside that directory. The lifecycle installation
runs fresh install, next launch and interrupted recovery. The failed-health
installation first establishes a healthy baseline, then exercises restoration.
Each stays within the unchanged two-history-plus-active transaction limit.
The portable regression consumes this same scenario plan and exercises actual
transaction admission, activation, health and recovery with fake native I/O.
Every GUI process starts with `--use-mock-keychain`; the fixture asserts it
before creating a window. A signed synthetic helper entry supplies that test
flag while delegating to the unchanged transaction helper implementation.
The synthetic installer uses the bundled Electron runtime. Tests cover fresh
installation, native app name and profile pins, scheduling without immediate
replacement, next-launch handoff, retained prior identity, staged interruption,
dead failed-health recovery and preserved synthetic writes. These do not prove
real-profile credential continuity or Gatekeeper approval.

Before creating any synthetic bundle copy, the harness measures the source
bundle and available bytes on the filesystem receiving its owned scratch root.
For each source entry it counts the greater of logical bytes and allocated
512-byte blocks; symlink targets are not followed. Let this measured total be
`B`. Five candidate copies plus five staged/installed/retained copies give a
peak of ten full bundles. Admission requires:

```text
additional peak = 10 * B + 1 GiB metadata/profile allowance
required available = additional peak + 2 GiB reserve
available = statfs(scratch root).bavail * statfs(scratch root).bsize
```

Unknown, malformed, out-of-range or insufficient measurements fail before
cloning. Already-present source/archive/build files are reflected in measured
free space and are not subtracted again. No sweep or unrelated cleanup makes
room. The harness owns the fresh root and its exact cleanup; root scheduling
and host-operation approval remain separate from this storage admission.

`native-smoke.json` records source identity, archive metrics, observed checks,
old/new receipts, per-installation checks, storage admission measurements and
sampled peak allocated disk. On failure,
`native-smoke-failure.json` records the failure and whether scratch cleanup
completed. Cleanup
signals only exact processes within the newly created synthetic root, checks
their exit and removes that root. Unknown/live process evidence retains the
root and fails; the hosted runner's lifetime is a second containment boundary.
Both process draining and the final cleanup gate use the native inventory's
kernel-reported executable paths; neither reads process argument strings.
Package-output cleanup requires its exact invocation marker.

## Release workflow

Pull requests against any base and manual runs create build artifacts only.
Activated canonical main pushes use the signed release path described above.
This includes a PR based on an unmerged source dependency; passing that run
does not satisfy the release source guard. A future explicitly
authorized `hq-desktop-*` tag push is the release trigger. The tag and workflow
commit must equal the observed `work/hq-foundation` head, with fixed repository
and owner numeric IDs. That development path has no branch-push publication or PR credential
access. The build has read-only repository permission. A separate tag-only job
uses OIDC to attest the archive and manifest together, copies the action's
JSON `bundle-path` as `hq-darwin-<arch>.sigstore.json`, and the final job creates
one preview release. Existing assets are never replaced or force-updated.
An uncertain or partial publication requires inspection before a retry.

Action pins were resolved from their official release tags: checkout 7.0.1,
setup-node 7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, attest 4.2.2.
The workflow uses Node 24.19.0. Native packaging uses macOS-provided
`xcrun`/SDK Clang, `ditto`, `zip`, `plutil`, `lipo`, and `codesign`; the ordinary package job selects explicit ad-hoc
development identity `-`, while the protected job selects Developer ID.

Source references: [Electron manual packaging at 44.9.0](https://github.com/electron/electron/blob/v44.9.0/docs/tutorial/application-distribution.md),
[GitHub hosted runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[attest 4.2.2 action inputs/output](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml),
and [Electron mock-Keychain test usage](https://github.com/electron/electron/pull/53790).
