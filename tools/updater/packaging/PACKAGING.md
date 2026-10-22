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
Packaging checks its architecture, signs it ad hoc, and verifies it before
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

Native smoke uses a new synthetic package/app/bundle identity and owned profile.
Every GUI process starts with `--use-mock-keychain`; the fixture asserts it
before creating a window. A signed synthetic helper entry supplies that test
flag while delegating to the unchanged transaction helper implementation.
The synthetic installer uses the bundled Electron runtime. Tests cover fresh
installation, native app name and profile pins, scheduling without immediate
replacement, next-launch handoff, retained prior identity, staged interruption,
dead failed-health recovery and preserved synthetic writes. These do not prove
real-profile credential continuity or Gatekeeper approval.

`native-smoke.json` records source identity, archive metrics, observed checks,
old/new receipts and sampled peak allocated disk. On failure,
`native-smoke-failure.json` records the failure before scratch cleanup. Cleanup
signals only exact processes within the newly created synthetic root, checks
their exit and removes that root. Unknown/live process evidence retains the
root and fails; the hosted runner's lifetime is a second containment boundary.
Both process draining and the final cleanup gate use the native inventory's
kernel-reported executable paths; neither reads process argument strings.
Package-output cleanup requires its exact invocation marker.

## Release workflow

Pull requests against any base and manual runs create build artifacts only.
This includes a PR based on an unmerged source dependency; passing that run
does not satisfy the release source guard. A future explicitly
authorized `hq-desktop-*` tag push is the release trigger. The tag and workflow
commit must equal the observed `work/hq-foundation` head, with fixed repository
and owner numeric IDs. There is no branch-push publication or PR credential
path. The build has read-only repository permission. A separate tag-only job
uses OIDC to attest the archive and manifest together, copies the action's
JSON `bundle-path` as `hq-darwin-<arch>.sigstore.json`, and the final job creates
one preview release. Existing assets are never replaced or force-updated.
An uncertain or partial publication requires inspection before a retry.

Action pins were resolved from their official release tags: checkout 7.0.1,
setup-node 7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, attest 4.2.2.
The workflow uses Node 24.19.0. Native packaging uses macOS-provided
`xcrun`/SDK Clang, `ditto`, `zip`, `plutil`, `lipo`, and `codesign` with ad-hoc
identity `-`.

Source references: [Electron manual packaging at 44.9.0](https://github.com/electron/electron/blob/v44.9.0/docs/tutorial/application-distribution.md),
[GitHub hosted runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[attest 4.2.2 action inputs/output](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml),
and [Electron mock-Keychain test usage](https://github.com/electron/electron/pull/53790).
