# HQ browser preview

A static browser bundle of the HQ shell with fictional Work and Social examples.
It is a separate infrastructure pilot (`hq-browser-preview`), not a native
Electron build or the HQ design collection. Begin with the repository
[working agreements](../../../AGENTS.md) and [UI map](../../../docs/ui-map/README.md).

From the repository root with the locked dependencies installed and Node 24:

```sh
npm run build
node apps/desktop/scripts/build-browser-preview.mjs --verify-production
node apps/desktop/scripts/build-browser-preview.mjs --out /absolute/new-bundle
```

Commit source before the preview commands: both refuse a dirty worktree.
The output must be a new directory outside the repository. The builder never
replaces an existing bundle. It emits root `index.html` and `empty.html`, hashed
assets and a closed `jones-preview-bundle/v1` manifest. The printed
`bundleSha256` hashes canonical manifest JSON (recursively sorted keys, compact
separators, UTF-8), excluding its trailing newline; it is not a field inside the
manifest. Every other regular file appears in the sorted SHA-256 inventory.
Files and every bundle directory become read-only on success. Failed builds remove only
the output directory allocated by that invocation. An unhandled process/host
termination may leave an incomplete output; it must not be served or reused.

`source-closure.json` is an inventoried bundle artifact emitted from the actual
Vite build. It records repository files and digests from all resolved modules and
emitted asset provenance and the conservative tracked-source supplement, graph edges, compiler/package metadata, the lockfile,
build recipe and gallery descriptor. Locked dependency modules and Vite virtual
modules are classified separately. Explicit type-only imports are recorded with
source locations as erased build-time edges; they are not silently discarded or
claimed to be runtime dependencies. This includes the Design types referenced by
`interactive-runtime.ts`, whose runtime exports do not import Design composition.

The gallery producer must cover every `files[].path` in this artifact with its
complete input roots and validate those roots under its unchanged path guard.
Build success alone is not producer acceptance or proof of freshness. Do not
filter rejected required paths from the inventory. Typechecking remains a
separate whole-application check, including native types.

`--verify-production` rebuilds the normal renderer in memory, rejects preview
module identities and session markers, and compares every generated file to
`apps/desktop/dist`. Run the normal build first. Neither command serves or
deploys anything.

Production `App` and the browser entry mount the same `PresentationShell`.
Production retains its native module registration and reference providers. The
browser supplies the existing Work/Social fixture adapters and explicit
Design/Wiki unavailable surfaces; it does not import the production registry.
Registered preview references stay unavailable (Design project references and
unregistered kinds stay unknown); fixture items do not become live reference targets.

Each document installs independent in-memory local/session storage before
importing the shared presentation shell or its modules. It never reads or clears the origin's real stores.
A missing insecure-origin `crypto.randomUUID` uses only `getRandomValues` to
produce version 4 UUIDs. Secure-origin UUID support is left unchanged. No service
or desktop bridge is assigned. The normal production CSP blocks connections.
Both entries open Work: `index.html` has examples, `empty.html` has no Work items.
The wall clock is used; capture evidence must record its observed date.

The keyboard-reachable bottom-right badge, reset button and capability disclosure
identify the source revision and limitations. Reset reloads the document. Shell
navigation, appearance, rail resize, example Work create/edit and example Social
navigation are available. Native previews/dialogs, Wiki, endpoint settings,
Jones Code, project sources, live services, persistence and insecure-origin
clipboard are unavailable. The same [capability constant](../src/preview/capabilities.ts)
feeds the disclosure and manifest. A bootstrap failure leaves the shell unmounted and
displays an alert with `data-preview-state="failed"`.

The requested error entry is omitted: the existing Work `FixtureControl` has no
reject-next-write operation. The separate `FaultControl` is not the confirmed
interface, so this preview adds no new fixture machinery. Unknown entry metadata
fails closed. Production service selection still requires an explicit valid
unconfigured response before using examples.

Run the direct proving tests with:

```sh
node_modules/.bin/vitest run apps/desktop/src/preview --maxWorkers=1 --no-file-parallelism
```

They belong to the existing `hq-root-build` glob in
[the check catalog](../../../tests/check-groups.toml). Affected existing groups
are `hq-root-build`, `hq-shared-bridge`, `hq-work-runtime` and `hq-social-live`;
their deduplicated test union is desktop, contracts, Work and Social. Shared
VPS checks require fresh admission and the assigned serial test slot.

[gallery-project.json](gallery-project.json) supplies the stable producer ID.
The separate gallery consumer maps sealed bundles to website variations and
runs its own validation/completion. No thumbnail is supplied until an actual
capture of this exact bundle exists. Browser geometry, responsive/accessibility
journeys, native Electron qualification, gallery completion and publication are
separate checks; source tests and build success do not establish those outcomes.
