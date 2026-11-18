# Design projects section (T2 / HQD-01)

Project content for HQ Design: several views per project, append-only immutable
versions per view, thumbnails, a gallery grid with filters and collapsible
groups, and a project switcher. Content is keyed by the HQ `ProjectId`.

Task: `spec.hq-design#task.projects.001` · Test: `spec.hq-design#test.projects.001` ·
Writer cone: `modules/design/projects/` only.

## What is here

| Path | Purpose |
| --- | --- |
| `src/contract.ts` | Section-local ports: `ProjectStoragePort`, `ProjectRegistryPort`, `ThumbnailPort`, `CatalogReadPort`, `ClockPort`, plus the source-catalog display types (`hq.design.source-catalog/v1` shapes). |
| `src/ids.ts` | Branded `ProjectId`/`ViewId`/`VersionId`/`HostId`/`SourceProjectId`. A shell `ProjectContext.id` is accepted unchanged. IDs never derive from titles. |
| `src/content.ts` | `hq.design.project-content/v1`: views, versions (bound to route, viewport, source revision and capture digest), explicit `WorkspaceSourceLink`s. Strict parser. `assertAppendOnly` refuses edited, removed or reordered versions. |
| `src/repository.ts` | One workspace document per project, written with compare-and-swap after the append-only guard. Future-schema or invalid documents open read-only and are never rewritten. |
| `src/registry.ts` | **Provisional** local registry. It is labelled provisional in its provenance and in the UI. Root replaces it with the HQ foundation's shared registry adapter. |
| `src/gallery.ts` | Gallery items: editable workspace projects plus read-only source entries with host and freshness badges. Search, origin, host and freshness filters, sorting, grouping and group collapse. Matching titles or remotes never merge records. |
| `src/grid.ts` | Virtual grid geometry, visible-block query and visible-first, bounded, deduplicated thumbnail planning. |
| `src/loader.ts` | A coalescing lazy loader with bounded concurrency. Visible requests run before prefetch, and the transport is aborted only after every subscriber cancels. Thumbnails become `data:` URLs only after media type, size and SHA-256 checks pass (the renderer CSP allows `img-src 'self' data:`). |
| `src/session.ts` | Pure navigation state: per-project selection, filters, collapsed views and scroll, plus gallery filters, collapsed groups and scroll. Also shell destination strings and an optional memory export. |
| `src/controller.ts` | Composes the ports for React through `subscribe`/`getSnapshot`. Navigation never writes. A late load for an inactive project only fills that project's local copy. |
| `src/views/` | React views written with `createElement`, so Node can run them without a JSX step: `ProjectsSection`, `ProjectSwitcher`, `GalleryView`, `ProjectDetail`. |
| `src/projects.css` | Section styles. They use the shell tokens (`--surface`, `--text`, ...). |
| `fakes/` | **Labelled fakes** and synthetic fixtures (`FAKE_LABEL`). Removable from a finished product. |
| `harness/` | Browser harness with 500 synthetic projects, built on the labelled fakes. Removable. |

## Composition (root)

```ts
import { createProjectsSection, ProjectsSection, projectIdFromContext } from './modules/design/projects/src/index.ts';
import './modules/design/projects/src/projects.css';

const { controller } = createProjectsSection({
  registry,     // HQ shared registry adapter (until then: createProvisionalLocalRegistry, labelled)
  storage,      // Design StoragePort adapter; this section writes only workspace `design.projects/*`
  thumbnails,   // preview transport (store/discovery own the cache namespace)
  catalog,      // cached source catalog read port; rendering never waits on refresh
  onDestination: modulePort.navigate,
});
controller.applyDestination(modulePort.destination); // 'projects' | 'projects/<encoded ProjectId>'
// render: createElement(ProjectsSection, { controller })
```

The section writes no drafts, cache, journals or receipts. Switching projects
performs no storage writes at all. UI memory stays in the process; root may
persist `exportSessionMemory()` wherever it keeps shell UI state.

## Checks

From the HQ root (Node 24, no extra dependencies):

```sh
node_modules/.bin/tsc -p modules/design/projects/tsconfig.json
node --test --test-concurrency=1 'modules/design/projects/test/*.test.ts'
```

Browser harness (synthetic, loopback only):

```sh
node_modules/.bin/vite --config modules/design/projects/harness/vite.config.ts
# open http://127.0.0.1:5199/?count=500   (&theme=dark)
```

Server-render tests check component output and semantics only. They are not
evidence of browser layout. Grid arithmetic is not rendered proof either. Only
the harness exercises a real browser DOM, and only with fakes. Real store,
registry, catalog and preview adapters remain unqualified until root wires them.
