# Reference producer

A local, Node-only command that turns an owner's own exported reference material into
`hq.design.reference-packet/v1` files (`internal` and `publishable`) plus content-addressed blobs,
using the reference graph library in `../src`. It is a clean-room adapter: the input formats it
accepts are listed in [FORMATS.md](./FORMATS.md). Nothing in `../src`, `../ui` or the app imports
it, it uses no network, and it keeps no state in this repository.

```
node modules/design/references/producer/src/cli.ts <config.json>
```

The configuration (`hq.design.reference-producer-config/v1`) lives outside the repository. It names
the output store, each source's directory, and any default rights, producer label and byte caps.
Its values, and everything in the source material, stay out of this repository, the command's
output, tests and evidence. The command prints aggregate counts and digests only.

## Behaviour

- **Reads only what a manifest names.** No directory walking, no HTML, scripts, styles or SVG.
  Every path is checked per component: no symbolic links (except the one declared gallery pointer,
  resolved once), regular files only, byte and file-count caps, digests and sizes verified.
- **Generation-safe.** Every file read is fingerprinted and rechecked, and the pointer is resolved
  again, before anything is written. A change anywhere aborts the run with no output.
- **Rights only tighten.** The more restrictive of the source default and a capture's own statement
  wins. A grant needs a basis. Private and non-redistributable captures stay out of the `publishable`
  packet and are listed in its `excluded` section. Claims are recorded as agent-reported at most.
- **Owned external output.** The store directory is created or adopted only when empty or already
  marked, is refused if the path or its real path has a Git ancestor of any kind (a `.git` directory
  or a `.git` file), must not overlap a source, is written with owner-only modes, and gets a
  packet set staged and renamed into place. Re-running an unchanged source writes nothing.
- **Deterministic.** A fixed clock and sorted, closed-shape packets: the same input gives the same
  digests.

## Checks

```
node_modules/.bin/tsc -p modules/design/references/producer/tsconfig.json --noEmit
node --test --test-concurrency=1 modules/design/references/producer/test/*.test.ts
```

Tests use hand-authored synthetic fixtures in temporary directories. Whether a real corpus conforms
to the formats is unqualified until the owner supplies an authorized input.
