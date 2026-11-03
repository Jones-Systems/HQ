# HQ F5 · References view builder: handoff

Paused by the owner mid-lane. The build is feature-complete against the brief and verified; what remains is review, a real-host check and one doc. No PR is open and nothing is merged.

## Where it stands against the brief

| # | Brief item | State |
|---|---|---|
| 1 | Multi-file import queue (rows, thumbnails, per-item state, form for current item, "Use these source details for the rest", `StatusIndicator busy`) | Done |
| 2 | Drag and drop overlay ("Drop screenshots to import", dashed accent edge, `hq-enter-fade`; PNG/JPEG/WebP queue, other types get a warning toast naming them; button path intact) | Done |
| 3 | F1 feedback (success toast with "Rate taste", info toast for kept-existing/tombstoned with existing wording, `toast.unknown` + Check with pause-until-reload kept, `FieldError`, status line removed, scroll to new card + `hq-flash`, `useListMotion` + `data-hq-motion-key`, `hq-stagger` on first load) | Done |
| 4 | Cards (`hq-lift` + `hq-press`, focus ring, image untouched, `Skeleton` until load, `auto-fill` grid ~200px, roving arrow-key focus, Enter opens detail) | Done |
| 5 | Detail lightbox on `@hq/ui` `Dialog` (large image under preserved-content rules, provenance, actions, left/right, Escape returns focus) | Done |
| 6 | "Rate taste" on every card and in the lightbox via optional `onSendToTaste`; wired in `mountReferences`; "Queued for Taste" marker from `useHandoffQueue()` | Done |
| 7 | Cross-link to Imports (empty library + quietly in the import panel) | Done |
| 8 | Collections as a compact chip row with inline "New collection" | Done |
| - | Evidence screenshots (1280x820 light/dark, 1680x1000, interaction states) | Done; six are in this branch, the rest only in `/tmp` (see "Exists only outside git") |
| - | Tests | Done for the new logic (4 new files); see Checks |
| - | `docs/ui-map/references.md` update | Not started (not an owned path) |
| - | Real Electron host check | Not started |

## Branch, worktree, head

- Branch: `work/hq-life-design-sources-references-20261103`, cut from `work/hq-life-design-sources-20261103` @ `f5d6bc8dfbd058905ed65ccaf5a2ff8f794cd415`.
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-design-sources-references-20261103`
- Last code commit: `4cd4259e07d85ba80ee20486a3b94cac7a71f2aa`.
- Evidence commit: `1073eb4dc666ef75458754943d346a4098a1d2fb`.
- The branch tip is the commit that adds this handoff, which cannot name its own SHA. The pushed head is reported in the hand-back message.
- Commits on the branch: `639db91` (main build), `6a104c3` (CSS polish), `4cd4259` (tests), `1073eb4` (WIP screenshots), then this handoff.

## What was built (files)

Library UI (`modules/design/references/ui/`):
- `ReferenceGrid.tsx`: card grid, roving focus, skeleton-until-load, reveal and flash.
- `ReferenceLightbox.tsx`: `Dialog` lightbox with an inline no-DOM fallback.
- `ReferenceCollections.tsx`: chip row and inline add.
- `ReferenceLibraryView.tsx` and `ReferenceLibraryPanel.tsx`: drop overlay, new props, `InlineNotice` banner.
- `view-model.ts`: adds `queuedForTaste`, `lightboxPosition`, `gridFocusTarget`, `LibraryViewOptions`.
- `index.ts` and `references.css`: exports, and a rewritten stylesheet with the graph rules preserved.

Section (`modules/design/app/sections/references/`):
- `queue.ts`: pure queue reducer, outcome mapping and drop filtering.
- `use-screenshot-importer.ts`: the importer hook.
- `ScreenshotImport.tsx`: queue UI, form and validation.
- `View.tsx`: wiring.
- `images.ts`: adds `readThumbnail`.

Wiring: `mountReferences` in `modules/design/app/compose/closure-views.tsx`, and nothing else in that file.

## Decisions and why

- **Lightbox is a sibling outside `.hq-refs`.** The library uses `container-type: inline-size`, which makes fixed-position descendants relative to the 572px container instead of the viewport. Rendering the dialog beside the section, not inside it, avoids that.
- **No portal.** The renderer-safe import rule allows only relative imports, `@hq/ui`, `@hq/contracts` and `react`, so `react-dom`'s `createPortal` is unavailable.
- **`Dialog` is not SSR-safe.** It reads `document.activeElement` at render. The lightbox renders an inline fallback when `document` is undefined, so existing static-markup tests keep passing.
- **Thumbnails are `data:` URLs.** The shell CSP has `img-src 'self' data:` and no `blob:`. `readThumbnail` validates the image header before decoding, bounds the dimensions, and draws through `createImageBitmap` and a canvas.
- **Queue logic is pure and lives in `queue.ts`.** A section `.ts` file must be erasable and import no `.css`, and the pure module lets node tests cover it.
- **A failed current item stays on the form; an unknown one does not.** Rejected input is fixed in place. An unconfirmed save is never resubmitted by the form, because it may already be saved.
- **Unknown pauses importing until `library.reload()`.** This keeps the old behaviour. It shows as a persistent `StatusIndicator` with a Check action, plus an unknown toast.
- **One batch toast id (`design-references-import`).** Multi-file runs update one toast in place rather than stacking.
- **A clean queue clears itself after 2.4s;** one with a failure stays until cleared.
- **Roving focus:** only the active card's open button and footer buttons are tabbable, so a long library costs one Tab. Column count is read from layout (`offsetTop`); the key maths is the pure `gridFocusTarget`.
- **One existing assertion changed** in `preview-lifecycle.render.test.tsx`: `expect(scroll).toHaveBeenCalledTimes(1)` became `expect(scroll).not.toHaveBeenCalled()`, with a comment. Details now open in a lightbox that doesn't scroll the page. This needs the lead's sign-off.

## Findings

- **F1 gap, `Dialog`:** not SSR-safe, and there is no portal under the renderer-safe rule.
- **F1 gap, containment:** `container-type` on a parent traps fixed-position dialogs. This deserves a note in the `Dialog` docs.
- **Card appears before its row flips to Saved.** With an artificially slowed digest (600ms to 1.8s per call, test-only), the new card showed in the grid while its queue row still read "Importing". It is probably the library state updating before `importScreenshot` resolves. It was only seen under the artificial delay and is cosmetic. I did not investigate.
- **Batch "Rate taste" sends every reference saved in that batch to Taste,** not just the last. This is intended, but the toast label doesn't say how many.
- **Docs are stale:** `docs/ui-map/references.md` still describes the old details panel and breakpoints.
- **Dark and 1680 reviewed by eye:** contrast and layout looked right. No automated a11y or contrast audit was run.

## What's left, in priority order

1. **Lead review of the changed assertion** in `preview-lifecycle.render.test.tsx` (above).
2. **Real-host check in the Electron design host.** Everything visual was checked in Chromium against the Vite dev server (a dev server on the assigned port, 5282, since stopped). Check there:
   - a real OS file-manager drag onto the library (my drag tests dispatch synthetic `DragEvent`s with a `DataTransfer`);
   - thumbnails via `createImageBitmap`;
   - the shell CSP with no violations in the console.
3. **Update `docs/ui-map/references.md`** for the lightbox, queue, drop overlay and grid. It is outside this lane's owned paths, so the lead should assign it.
4. **Optional coverage:** a vitest case for `readThumbnail` with a stubbed `createImageBitmap` (currently browser-only).
5. **Optional polish:** look at the "Importing" row vs card ordering above; word the batch toast's Rate taste action with a count.
6. **When work resumes:** open the PR from this branch against `work/hq-life-design-sources-20261103`. None exists, per instruction.

## Open questions and risks

- The one changed existing assertion (above) is the main review item.
- The lightbox's inline SSR fallback is a workaround for an F1 limitation. If F1 makes `Dialog` SSR-safe, it can be deleted.
- `lastModified` supplies the default capture date, as before. The queue keeps that behaviour per file.
- Not exercised: Safari or WebKit, and a non-Chromium `createImageBitmap`. `readThumbnail` returns null when unavailable, so rows fall back to a placeholder glyph.
- Reduced motion was verified by a capture run with the reduced-motion media feature, not by an automated test.

## Checks run (all serial, all passing)

| Command | Result |
|---|---|
| `node_modules/.bin/tsc -p modules/design/references/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/references/test/*.test.ts` | 159/159 |
| `node_modules/.bin/vitest run --config modules/design/references/vitest.config.ts` | 23/23 (5 files) |
| `node_modules/.bin/tsc -p modules/design/app/sections/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/app/sections/**/*.test.ts` (`shopt -s globstar`) | 45/45 |
| `node_modules/.bin/vitest run --config modules/design/app/sections/vitest.config.ts` | 12/12 (2 files) |
| `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197/197 |
| `npm run typecheck` | pass |

New tests: `modules/design/app/sections/test/references-queue.test.ts` (12 node tests), `modules/design/references/test/view-model-browse.test.ts` (5 node tests), `modules/design/references/ui/browse.render.test.tsx` (8 vitest), `modules/design/app/sections/test/references-import.test.tsx` (8 vitest). Each sits under an existing CI inventory row; `tests/check-groups.toml` is untouched.

Caveats on the run: three early vitest runs of the new render tests started while a CPU sample read above 85% (they were short, about 1 to 6s each); after that a gate script held every run below 85%. I did not run the full repository suite, only the rows above plus `npm run typecheck`. After the stop message I ran no tests or builds.

## Exists only outside git (the next owner will not find these in the repo)

- `/tmp/hq-f5-evidence/references/`: all screenshots (67 files in `shots/`), the Playwright capture scripts (`tools/*.mjs`, `tools/gate.sh`), the synthetic fixtures (`fixtures/`, including a deliberately broken PNG and a text file) and the raw check outputs (`checks/`). `/tmp` may be cleared.
- Only six screenshots are committed, under `docs/design/hq-visual-system/evidence/sources-20261103/wip/references/`:
  - `A-grid-light-1280.png`
  - `A-grid-dark-1280.png`
  - `A-grid-light-1680.png`
  - `D-lightbox-dark-1280.png`
  - `F-queue-failed-light-1280.png`
  - `G-unknown-light-1280.png`
- No uncommitted work remains in the worktree. The brief files are `/tmp/hq-f5-briefs/references.md` and `/tmp/hq-f5-briefs/common.md`, read-only and outside git.
- Nothing lives only in the delegating thread beyond this handoff.
