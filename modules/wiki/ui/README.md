# Wiki UI (`modules/wiki/ui`)

`createWikiView(service: WikiService)` for task `task.wiki-ui.001`. Write cone: `modules/wiki/ui/**` only.
Completion is not acceptance; the Wiki continuity owner decides acceptance.

Consumes only the accepted contract at `../contract/src/index.ts` (read-only). No core, `@hq/contracts` or
`@hq/ui` imports; production code uses no `node:*`, Electron, `fetch`, real sources or unsafe-render APIs.
Erasable `.ts` with `React.createElement`; no new dependencies.

## API

```ts
const WikiView = createWikiView(service);          // service: the seven-method, contract-only WikiService
<WikiView destination="home" appearance="light" navigate={(d) => …} />
```

`destination`: `home`, `page/<ns>/<encoded path>`, `search?q=…`, `topics/<ns>`. `navigate(d)` is a **request** that
the shell persist `d`; the view keeps its own in-session history either way. Styles ship as the separate
`src/wiki-view.css` (see packaging below); themes use `data-appearance` and `wiki-` classes only.

## What it shows

Home (display names, ref/commit/commitTime/indexedAt, graph freshness, remote freshness unknown); search with
`clampQuery`, repository filter, snippets, total/truncated and exact name matches via `resolveAlias`; reader
(namespace/path/commit provenance, ordinary fields, parsed AST or verbatim raw `pre` with its reason, out-links,
backlinks); topics tree (`parentId`, counts, previews); disambiguation; session history (back/forward/list).
Every request has loading and per-code error states (`invalid-input`, `not-found`, `unavailable` with
`source-unavailable` / `index-unavailable`, `internal`, plus rejected/malformed responses), and a sequence guard
discards any response that is not for the latest request. Responses are re-validated with the contract validators.

## Accepted decisions preserved (no repairs)

- `clampQuery`, not an HTML `maxLength`. Namespace display: `bl` → BusinessLessons, `appdev` → App Development.
- `home` or an unparseable destination shows home; an unparseable one also shows an inert notice.
- Refresh is host-only and never in `WikiService`; the view only touches the seven read methods.
- Page links are buttons that call `navigate`; external URLs are visible, non-clickable text; missing targets are
  inert and visibly missing; no `href`, `dangerouslySetInnerHTML`, `innerHTML` or `window.open`.
- Null-omitted frontmatter fields are simply absent from `fields` (no key presence is invented).

## Checks (run serially from the repository root after a fresh CPU admission reading)

```
node --test modules/wiki/ui/test/*.test.ts
npx --no-install tsc -p modules/wiki/ui/tsconfig.json --noEmit     # locked typescript 7.0.2
```

Result on candidate `cbd71af`: 10 test files, 105 tests, 105 pass, 0 fail, 0 skipped; `tsc` exit 0.
Mutation sanity checks (temporarily removing the sequence guard / adding `dangerouslySetInnerHTML`) make the
stale-response and static tests fail; both were restored. Tests use `node:test` + happy-dom (installed globally
by `test/dom.ts`, no registrator package) over a synthetic in-memory service whose data is validated against the
contract (`test/fixtures.test.ts`). They cover every view, filter, history, ambiguity, missing target, raw
content, script-looking text without script elements, seven-method-only calls (sealed Proxy), stale-response
guards, zero egress, and static source rules (forbidden APIs, import allow-list, no inline style).
Browser evidence: [`evidence/README.md`](evidence/README.md). Not shown: mounted shell, Electron, installed app.

## Deferred findings (recorded, not repaired, non-blocking)

Original, at original severity:

- **P2** (root seam): shell destinations cap at 512 characters while the Wiki can represent 16,384, so a long
  destination may not persist or navigate through the mounted shell. No root cap or alternate persistence is
  added; the view's in-session history still navigates (tested with a 512-limit shell). Mounted-shell acceptance
  must disclose this.
- **P3** (contract): omitted null frontmatter fields lose key presence; a lossless contract revision is deferred.

New, found while building (at the severity I would assign; none implemented):

- **P3** contract: `checkTopicList` rejects self-parents and unknown parents but not longer `parentId` cycles. The
  UI guards (`topic-tree.ts` surfaces cycle members as roots), but another consumer could loop.
- **P3** contract: disambiguation and the repository filter have no destination form (only `page`, `search`,
  `topics`), so they exist only in in-session history and are not restored by the shell.
- **P4** contract: topic previews and alias candidates carry `PageKey` only (no titles), so those lists show paths.
- **P4** UI: the echo-vs-external heuristic can mis-handle a shell that never echoes two different long
  destinations in a row (tied to the P2 gap).
- **P4** UI: `home` is a UI convention, so an empty-string destination shows the unrecognised notice.
- **P4** UI: rendering cost for very large pages (up to 200,000 AST nodes) and 500-topic trees is unmeasured;
  responses are validated again in the view.
- **P4** UI: focus moves to the main region after navigation but there is no screen-reader or narrow-viewport
  verification.

## Packaging obligations for the held integration owner (not done here)

1. **CSS:** the shell CSP is `style-src 'self'` (apps/desktop/index.html), so `<style>` and inline styles are blocked.
   The root must import `modules/wiki/ui/src/wiki-view.css` as a file; the view uses classes and data attributes only.
2. **Workspace wiring:** add a `package.json` (private, `react` dependency, exports) for the UI module and register
   it; root `tsconfig.json` and `vitest.config.ts` do not list `modules/wiki`. Root typecheck needs
   `allowImportingTsExtensions` (sources import `./x.ts`) and `erasableSyntaxOnly`-compatible settings.
3. **Test runner:** these tests use `node:test`. If `modules/wiki` is added to the root vitest roots, its
   `**/*.test.ts` glob would pick them up and fail ("no test suite"); keep a separate `node --test` script or
   exclude them. `node --test` on `.ts` needs Node with type stripping (22.18+/24), while root `engines` allows
   >=22.12.
4. **Contract promotion:** the view imports `../../contract/src/index.ts`; repoint if the contract moves into
   `@hq/contracts`.
5. **Mounting:** the registry's `ModulePort` is a structural superset of `WikiViewProps`; the preload/IPC host must
   supply exactly the seven `WikiService` methods and keep refresh host-only. Existing shell destinations must
   migrate so that `home` maps to the Wiki home. The shell's 512-character destination cap is the P2 above.
6. **Browser/mounted evidence** for the shell, Electron and installed app remains a separate effect.
7. The harness (`harness/`) is cone-local and not part of any root build; it needs the root's hoisted `vite`,
   `react` and `react-dom`.
