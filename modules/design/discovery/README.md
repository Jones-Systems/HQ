# Design discovery (T15 / HQD-14)

This module lets the laptop show projects from enrolled sources. It keeps a local cached catalog, refreshes it in the background with bounds, and fetches previews only when they are needed. The editable Design workspace stays on the laptop and is never synchronized back. The module reads catalog metadata and previews. It never executes, clones or writes at a source. Execution belongs to the connector.

It implements `spec.hq-design#task.discovery.001` against `spec.hq-design#iface.source-catalog.001`.

## Layout

| File | Role |
| --- | --- |
| `src/contract.ts` | Section-local `hq.design.source-catalog/v1` types, branded IDs, and the ports for source adapter, clock, `cache` and `workspace` |
| `src/jcs.ts`, `src/identity.ts` | RFC 8785 JCS + SHA-256 (WebCrypto). `SourceProjectId` = SHA-256 of JCS `{hostId,rootId,relativePath}`. Remote normalization for display evidence |
| `src/catalog.ts` | Strict snapshot validation and the pure catalog reducer |
| `src/cache.ts` | Catalog cache document and the byte-budgeted LRU preview cache, both in the `cache` namespace. Evidence adoption into `workspace` |
| `src/previews.ts` | Preview loader: coalesces by digest, cancels after the last subscriber, enforces global/per-host concurrency and a per-item byte limit, loads visible tiles first. Also lazy window planning |
| `src/discovery.ts` | `DiscoveryService`: opens from cache only, refreshes with a per-host timeout, guards against stale context/generation results, runs background refresh |
| `src/enrollment.ts` | Explicit enrollment, fingerprint re-verification and workspace links |
| `src/view-model.ts`, `src/CatalogView.ts` | Framework-free view model. React view (written with `createElement`, no JSX) with host and freshness badges and windowed lazy previews |
| `src/fakes.ts` | **Labelled fakes**: fake clock, in-memory cache/workspace ports, synthetic fake source adapter and fixtures |

## Guarantees checked by tests

- **Warm cache first paint.** A warm cache renders right away even when every source hangs forever.
- **Failures keep cached data.** A failed or partial refresh never removes records. The record keeps its freshness (`offline`/`timeout`/`error`/`partial`) and its `lastSuccessAt`, and the source carries its own error.
- **Missing at source.** Only a newer complete snapshot marks omitted entries `missing-at-source`. The entries are kept, so workspace links survive.
- **No merging by title.** Records are keyed only by `SourceProjectId`. Identical titles and remotes on different hosts or paths stay separate. Links are explicit (`'user-confirmed'`).
- **Stale results are ignored.** Older generations are dropped. When the context changes rapidly (A, then B, then C), only C is applied, and A and B transports are aborted. A context change also withdraws in-flight previews.
- **Previews are bounded.** Duplicate digests fetch once. The shared transport aborts only after every subscriber cancels. Concurrency and byte limits are enforced, visible tiles load before prefetch, and with 500 entries and 24 visible rows only the visible rows plus a bounded prefetch window mount.
- **Cold refresh times out per host.** Using the fake clock, a cold refresh returns useful partial results.
- **Host identity changes are held.** A changed host fingerprint is held as a conflict until the user explicitly re-verifies it.
- **Cache safety.** A corrupt cache is rebuilt without touching the workspace. A cache written by a newer schema is left unmodified and nothing is written over it. The cache is excluded from backups (`DISCOVERY_STORAGE_NAMESPACES`).

## Checks

From the repository root (Node 24, TypeScript 7.0.2 from the root dev dependencies):

```sh
node_modules/.bin/tsc -p modules/design/discovery/tsconfig.json
node --test --test-concurrency=1 'modules/design/discovery/test/*.test.ts'
```

`test/view.test.ts` uses the real React 19 renderer through `react-dom/server` static markup. It checks the rendered DOM structure and first-paint behaviour. It does **not** check browser layout, scrolling, or Electron capture.

## Not claimed

These fakes do not demonstrate any real source capability. Real remote enrollment, endpoint access, host authentication and native access each need a separately qualified adapter. A non-fake adapter without a `qualificationRef` is refused at enrollment. Root wiring of the durable store (T9) to `CacheStoragePort` and `WorkspaceEvidencePort`, Projects (T2) consuming catalog state, and the cumulative no-network-wait project switch (I4) are integration work for T1.
