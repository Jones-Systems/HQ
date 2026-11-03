# Wiki assembly (`modules/wiki/app`)

Task `task.wiki-assembly.001` (plan `docs/engineering-specs/hq-integration-parallel-execution.md`, interface
`iface.wiki-host-ipc.001`). Write scope: `modules/wiki/**` and `docs/evidence/hq-wiki/**` only. The contract, core
and UI directories are consumed read-only and unchanged. Completion is not acceptance: T1 decides acceptance, and
T2 mounts the module in the shell.

## What it adds

| File | Role |
| --- | --- |
| `src/port.ts` | `WikiHostPort` (the preload bridge: exactly the seven `WikiService` methods, results `unknown`) and `WikiModulePort` (structurally identical to `ModulePort`) |
| `src/client.ts` | `createWikiClient(getPort)`: a `WikiService` over the port. Guards requests, reads only the seven method names, validates every response |
| `src/domain.ts` | `createWikiDomain({ getPort })` → `{ id: 'wiki', label: 'Wiki', presentation: 'fill', Component }` |
| `src/references.ts` | `createWikiReferenceProvider(getPort, now)`: the Wiki as an HQ reference provider ([below](#reference-provider-x9)) |
| `src/wiki-domain.css` | Container styles (a file; the view's own `wiki-view.css` is reused unchanged) |
| `src/index.ts` | Production entry: imports both stylesheets as files, re-exports the domain, client and types |
| `fixtures/corpus/**` | Synthetic Wiki text for two namespaces; the tests commit it into bare Git repositories |
| `test/**` | `node:test` suites (below) |
| `../package.json`, `../tsconfig.json` | `@hq/wiki` package (private, `react` only, `engines.node >=22.18.0`) and the module typecheck |

## Behaviour

- **Seven methods, nothing else.** The client reads `port.listSources`, `search`, `getPage`, `resolveAlias`,
  `getBacklinks`, `listTopics`, `indexStatus` and no other member. A host-only `refresh` or home migration on the port
  object is unreachable (a Proxy test proves it is never read).
- **Requests are guarded before they leave.** The contract request validators run first; a `path`, `root`, `url`,
  `argv`, `cwd`, unknown property or over-limit value is answered locally as `invalid-input` and the port is never
  called. What is sent is a canonical plain copy with defaults filled.
- **Responses are validated.** Envelope, contract validators, and consistency with the request (a page for another key,
  topics for another namespace, alias targets in another namespace, duplicate source namespaces) are checked. Anything
  off-contract becomes `internal`; a missing or throwing bridge becomes `unavailable/source-unavailable`. A thrown
  message is never repeated, and a host error is rebuilt from its known fields only.
- **No bridge discovery.** `getPort` is supplied by the caller (T2 owns the preload global's name) and is read on every
  call. The module never touches `window`, `document`, `localStorage` or Electron.
- **CSS is a file.** `index.ts` imports `ui/src/wiki-view.css` and `wiki-domain.css`; a Vite build of the entry emits one
  external `.css` file and no style injection (`csp-build.test.ts`). Nothing uses inline styles, so
  `style-src 'self'` needs no change.

## Mounting (for T2)

```ts
import { createWikiDomain } from '../../../modules/wiki/app/src/index.ts'; // or '@hq/wiki' once registered
const wikiDomain = createWikiDomain({ getPort: () => /* the preload bridge, or null */ });
// slot: wikiDomain.Component   presentation: wikiDomain.presentation ('fill')   label: wikiDomain.label
```

See `docs/evidence/hq-wiki/README.md` for the full hand-off (root workspace, typecheck, Node, Vitest isolation,
destination migration and the 512-character destination cap).

## Reference provider (X9)

`createWikiReferenceProvider(getPort, now)` makes Wiki pages findable and openable from the other HQ apps ("Link to…",
the cross-HQ palette). The desktop registers it in `apps/desktop/src/reference-providers.ts` with the same bridge
supplier the domain uses. It is structural, because this layer does not import `@hq/contracts`; the registry proves at
compile time that it is a `ReferenceProvider`. It is built on `createWikiClient`, so every response is validated, and
it can only ever send two of the seven reads: `search` and `getPage`.

| | |
| --- | --- |
| Shape | `{ domain: 'wiki', kinds: ['page'], find, resolve }` |
| Identity | `entityId` is `<namespace>/<path>`; `returnDestination` is `{ domain: 'wiki', destination: 'page/<namespace>/<encoded path>' }` from the contract's formatter |
| `find` | Nothing for a scope whose `kinds` excludes `page`, a query the contract refuses (blank, over 256 code points, control characters) or a limit that is not a positive integer. Otherwise one `search`, bounded by the scope limit and the contract maximum of 50, in the host's order. Any failure finds nothing |
| Skipped hits | A hit whose id (over 160 characters, or leading or trailing whitespace), title (over 300) or destination (over 512 once percent-encoded) breaks the shell's envelope rules is skipped. Identity is never shortened, because a shortened identity names a different page |
| `resolve` | `getPage` on the key parsed from `entityId`. `available`, with `latestTitle`, `latestRevision` (the page commit) and `destination`; `changed` when the envelope carries a `sourceRevision` that differs from that commit; `missing` for not found; `unavailable` for an unavailable or failing host or no bridge; `unknown` for a malformed identity, another domain or kind, or a page that has no destination the shell can accept. `observedAt` is `now()` taken after the read |
| Opening | The shell navigates to the resolved destination and shows "Back to <origin>"; no shell change is needed |

Two properties follow from the contract and are worth knowing before building on it:

- `Page.commit` is the commit the namespace is pinned to, not a per-page revision. `changed` therefore means "the Wiki
  source has moved on since this reference was taken", not "this page's text changed".
- A search hit carries no commit, so a reference made from the picker has no `sourceRevision` and is never `changed`.

Desktop coverage: `apps/desktop/src/wiki-references.integration.test.tsx` drives the shell's reference port over a
scripted bridge, then the whole shell over the real host (Social "Link to…" → Wiki page → Back).

## Checks

Serial, from the repository root, after a fresh CPU admission reading:

```
node --test modules/wiki/contract/test/*.test.ts modules/wiki/core/test/*.test.ts modules/wiki/ui/test/*.test.ts modules/wiki/app/test/*.test.ts
npx --no-install tsc -p modules/wiki/tsconfig.json --noEmit
```

Both need Node >=22.18 (native TypeScript type stripping). The `app/test` suites:

| Suite | Covers |
| --- | --- |
| `client.test.ts` | Seven-method shape, request guards, exact-seven reads, failure mapping, response validation |
| `references.test.ts` | Reference provider: kinds, query and limit bounds, envelope shape, skipped hits, resolve states, only `search` and `getPage` reads, no bridge |
| `assembly.test.ts` | Real core over committed bare repositories (real Git adapter), read through the client over a structured-clone bridge: pins, freshness, symlink/submodule/non-page/outside-prefix exclusion, search, aliases, backlinks, topics, hostile Markdown, raw pages, host-only refresh, no writes |
| `mounted.test.ts` | The domain Component mounted with a `ModulePort` in happy-dom: home, search, reading, navigation requests, encoded paths, raw and hostile pages, appearance, no bridge |
| `static.test.ts` | Renderer source rules, stylesheet rules, package and layout rules, public-safety scans |
| `csp-build.test.ts` | Vite build of the entry: external CSS file, no style injection |

Test scratch (the bare repositories and the build output) lives under a unique directory in the user's home, never in
`/tmp`, and is removed on success, failure and cancellation (`test/scratch.ts`).

## Not shown

Mounted-shell behaviour, Electron, the preload bridge itself, and the installed app are separate effects (T2 and T7).
Responses crossing a real IPC channel are simulated with `structuredClone`; the real channel is not exercised here.
