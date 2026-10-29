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
| `assembly.test.ts` | Real core over committed bare repositories (real Git adapter), read through the client over a structured-clone bridge: pins, freshness, symlink/submodule/non-page/outside-prefix exclusion, search, aliases, backlinks, topics, hostile Markdown, raw pages, host-only refresh, no writes |
| `mounted.test.ts` | The domain Component mounted with a `ModulePort` in happy-dom: home, search, reading, navigation requests, encoded paths, raw and hostile pages, appearance, no bridge |
| `static.test.ts` | Renderer source rules, stylesheet rules, package and layout rules, public-safety scans |
| `csp-build.test.ts` | Vite build of the entry: external CSS file, no style injection |

Test scratch (the bare repositories and the build output) lives under a unique directory in the user's home, never in
`/tmp`, and is removed on success, failure and cancellation (`test/scratch.ts`).

## Not shown

Mounted-shell behaviour, Electron, the preload bridge itself, and the installed app are separate effects (T2 and T7).
Responses crossing a real IPC channel are simulated with `structuredClone`; the real channel is not exercised here.
