# HQ F5 · Design Sources · Taste — handoff (paused by the owner)

Status: **paused**. The Taste brief was built and checked before the pause; one defect found by the last check run was fixed and re-checked. Nothing is mid-edit. Stopped at a safe point, no new slice started.

- Branch: `work/hq-life-design-sources-taste-20261103` (from `origin/work/hq-life-design-sources-20261103` @ `f5d6bc8`, which is an ancestor of the head)
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-design-sources-taste-20261103`
- Code head: `6346fd965a0ea7a227e613177f3a5926bba863c1` (last code change, all checks below ran against it). Two WIP commits follow it: the six screenshots (`da2f08c`) and this handoff. The final pushed head is the tip of the branch on origin.
- No PR opened. Nothing merged. #168 and #179 were not touched.

## Where it stands against the brief

| Brief item | State |
|---|---|
| 1. Fix the 572px overlap with container queries; segmented 1–5 control incl. Description rows | **Done** (not captured at narrow width, see Left) |
| 2. "Waiting to rate" deck fed by a Taste-owned context, filled by `TasteSourcesView`; loader repointed | **Done** |
| 3. QuickRateDeck: card, peek, keys, legend, drag, stamp, fly-off, submit, recents, toasts, failure/unknown handling | **Done** |
| 4. Full aspect form kept; Saved rows flash + inline Saved; post-load problems as InlineNotice | **Done** |
| 5. Screenshot seeding via Playwright only, no demo path shipped | **Done** |
| Tests: deck (keyboard rate, skip, unknown keeps card, empty renders nothing), segmented control, existing | **Done** |
| Checks list | **Done**, all green on the code head |
| Collision rule for #168 / #179 | **Done**, conflict-free (see Risks) |
| Final report to the lead | Delivered before the pause |

## What was built (by journey step)

1. **Layout and rating control.** `taste.css` rewritten around a `container: taste / inline-size` container: stacked by default, two columns at ≥900px, container-width rules for the narrow case. `RatingRow.tsx` (moved out of `TastePanel.tsx`) is a segmented 1–5 control with native radio inputs and the same aria-labels as before (`Overall: 4, Like`, `Typography: 3 of 5`), a sliding pill on token durations (no motion under reduced motion), a visible number on every step, the chosen word beside the control, and anchors for Description rows. Arrows and Home/End move focus only; Enter or a click chooses. After a save the row gets focus back if nothing else holds it.
2. **Queue plumbing.** `queue-context.ts` (Taste-owned context: items, `onRated`, `onSkipped`, `originLabel`). `modules/design/app/compose/views/TasteSourcesView.tsx` reads `useHandoffQueue(tasteQueue)`, removes an item from `tasteQueue` once it is rated or skipped, and maps the sender to a title ("From References"). `design-module.ts`: only the `view` loader changed.
3. **Deck.** `QuickRateDeck.tsx`, `DeckCard.tsx`, `deck-model.ts` (pure, erasable TS), `deck.css`. One card with the next peeking behind it; image in a `PreservedContent` well (data/same-document URLs only, glyph fallback); Not for me (2) / Like (4) / Love (5) / Skip / exact 1–5 disclosure; ←=2 →=4 ↑=5 ↓|S=Skip 1–5 exact; visible legend; pointer drag past a 96px threshold with gentle rotation and a "Like · 4" stamp; `animateElement` fly-off (instant under reduced motion); "Just rated" chips; inline Saved note that fades after 6s; success toast. Rating = overall liking `assessment.recorded` in the current scope with a validated, stable subject id.
4. **Outcomes.** `failed` → `toast.error`, card snaps back and stays, form reload so the next try is current. `unknown` (write-failed, partial-write, sync-failed, or a thrown submit) → `toast.unknown`, card stays marked unknown, **Check** reads the journal and writes nothing, **Retry same entry** resends the identical command (same client event id, cannot duplicate). Nothing says "saved" without a confirmed result. Last card rated → focus goes to the "Everything waiting is rated" message instead of dropping to the page.
5. **Full form.** `TastePanel.tsx` has minimal edits (imports, a `Presence`/`InlineNotice` for post-load read problems with a Retry, the `QuickRateDeck`, and the extracted `RatingRow`). Saved rows get `hq-flash` and a "Saved" `StatusIndicator`.

## Decisions and why

- **Native radios kept in `RatingRow`.** Open PR #168 has tests that use `getByRole('radio', { name: 'Overall: 4, Like' })`; keeping the markup contract means they still pass after merge (verified in a scratch merge: taste vitest 37/37, app vitest 8/8, both tscs ok).
- **Context defined in `taste/src/ui/`, filled by a new file under `app/compose/views/`.** Sections stay independent (Taste imports no section or `app/`); `TasteView.tsx`, the `taste/src/*.ts` services and the journal are untouched, which is what keeps #168/#179 conflict-free.
- **Arrow keys move focus in a row, they don't rate.** Passing over steps must not write a judgment; Enter or click commits. Deck keys are the opposite on purpose (the deck is a fast triage surface), and are ignored inside inputs and with modifier keys.
- **Async deck work reads a `latest` ref, not render closures**, so toast actions from earlier renders stay correct.
- **`released` ref + ignore `event.repeat`** (the last fix): see Findings.
- **Unconfirmed writes are never "saved".** `classifyAppend` maps only a confirmed append to saved; refusals are failed; the uncertain fail-closed reasons are unknown.
- **CSP-safe motion.** Drag and fly-off use CSSOM transforms and WAAPI; stamp strength is a custom property; no `style` attributes in markup, no inline `<style>`, no `blob:`.
- **Deck logic tests are vitest (`test/ui/deck-model.test.tsx`), not node.** Taste's CI row allows node `test/*.test.ts` and vitest `test/ui/**`; an extra node-style file under `test/ui` would not run. This is why the node test count is 36, not the 58 seen mid-work.

## Findings

- **Real defect found by the gated run and fixed (`6346fd9`).** The deck read the front card from a ref refreshed after commit, so a key pressed between handing a card back and the next render acted on that card again: a second skip of the same card (the next key lost), or a second rating of an already-saved item. Fix: remember the card last released and ignore it; auto-repeat of a held key counts as one press. Regression test `acts once on a card the owner has not removed yet, and never on a held key`; with the guard removed it fails (received `[PRICING, PRICING]`), restored it passes.
- Chromium drops focus from a control when its fieldset becomes disabled during a save → `RatingRow` refocus effect plus a test.
- happy-dom does not report `:disabled` through a fieldset → the test asserts `fieldset.disabled` instead.
- Every Playwright capture logs one `Failed to load resource … 404`; probably the favicon, **not investigated**.
- No F1 (`@hq/ui`) primitive gaps blocked the work. Used: `useToast`/`ToastStoreProvider`, `InlineNotice`, `StatusIndicator`, `Presence`, `useListMotion`, `useReducedMotion`, `animateElement`, `Button busy`, `PreservedContent`, `hq-flash`.

## What's left, in priority order

1. **Owner decision on integration order (needs the lead).** This branch has not been merged anywhere; whoever integrates should merge #168 first or alongside and re-run the checks (see the #168 risk below).
2. **Resolve the `setSnapshot(null)` behaviour once #168 lands.** Next step: after merging #168, decide whether a failed reload should keep the form (show my `InlineNotice` with Retry) or hide it (#168's behaviour), and add a TastePanel-level test for whichever is chosen. I deliberately did not write that test now, because it would contradict #168.
3. **Narrow-width evidence.** The 572px overlap fix is covered by container-query CSS, and there are 1280 and 1680 captures, but I have no capture of the Taste container at ≈572px or below. Next step: run the dev server on an assigned port, seed `tasteQueue` as `tools/lib.mjs` does, and capture at 572 and 760 wide.
4. **Dark-mode and reduced-motion coverage is thin.** Only the default view has a dark capture; reduced motion only has the keyboard scenario. Next step: run `interact.mjs` with `theme=dark` for drag/unknown/exact and `REDUCED=1` for drag.
5. **The 404 in the console log**: confirm it is the favicon and not a Taste asset.
6. **Optional polish, not required by the brief:** the deck's `SENDER_TITLES` in `TasteSourcesView.tsx` imports four descriptor modules just to build titles; a smaller map owned by the compose layer would remove that coupling.

## Open questions and risks

- **Merge-tree, re-run after the screenshot commit (code head `6346fd9` + screenshots):**
  - `git merge-tree --write-tree --name-only HEAD origin/work/hq-taste-production-mount-20261026-r1` (#168 @ `13cbbd1467d6`): exit 0, clean, tree `ae36bafb25e5a9ea66aae05c6527a4024497974d`. **Still conflict-free.**
  - Same against `origin/work-hq-t1-app-source-compose-20261103` (#179 @ `c83294b0309f`): exit 0, clean, tree `955708a767162667844b4b39076b93bfd8e5ea03`.
  - Not re-run after this handoff commit (a docs-only add under a new path).
- **#168 semantic overlap (not a textual one).** #168 sets `setSnapshot(null)` on a failed reload, which hides the whole form; my `InlineNotice` for post-load read problems only shows where the snapshot is kept, as on the lane base. After integration the form hides instead of showing the notice. Nothing breaks.
- **Risk: the shared journal write path is exercised only through fakes.** The fake file system and in-memory service back the tests; no real-journal run was done in this lane.
- **Risk: key shortcuts in the deck are always on while focus is in the deck group.** They are ignored in text fields and with modifier keys, but a screen-reader user in browse mode may trigger a rating; Skip and Not-for-me are one key each. Worth a second look from an accessibility reviewer.
- **Question for the lead:** is "From <Sender>" the final origin wording? It is a one-line change in `TasteSourcesView.tsx`.

## Checks run (all against code head `6346fd9`; CPU under 85% before each; one serial process at a time)

| Command | Result |
|---|---|
| `node_modules/.bin/tsc -p modules/design/taste/tsconfig.json` | exit 0 |
| `node --test --test-concurrency=1 modules/design/taste/test/*.test.ts` | 36/36 pass |
| `node_modules/.bin/vitest run --config modules/design/taste/vitest.config.ts` | 4 files, 55/55 pass |
| `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` | exit 0 |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197/197 pass |
| `npm run typecheck` | exit 0 |
| deck test file, three extra serial runs | 17/17 each |

History worth knowing: the **first** gated run (code head `4e54c21`) had **one failing test** (`skips with ↓ or S without writing anything`, a 1s `waitFor` timeout) — that was the defect described above, fixed in `6346fd9`, not weakened away. The #168 scratch merge (at `4e54c21`) was checked as noted under Decisions. No tests or builds were run after the pause message arrived.

## Exists only outside the commits

- `/tmp/hq-f5-evidence/taste/` on the build host: the full screenshot set (~36 PNGs; six are copied to `docs/design/hq-visual-system/evidence/sources-20261103/wip/taste/`), the Playwright tools (`tools/lib.mjs`, `default.mjs`, `scroll.mjs`, `interact.mjs`, `keys-row.mjs`, `final-checks{,2,3}.sh`), the check logs (`final-checks-run{1,2,3}.log`) and the merge-tree outputs. The six committed screenshots are `taste-light-1280x820`, `taste-dark-1280x820`, `taste-light-1680x1000`, `drag-light-1280x820-3-armed`, `unknown-light-1280x820-2-after-check`, `form-light-1280x820-y440`. A before capture is at `/tmp/hq-f5-evidence/before/taste-light-1280.png`. `/tmp` is not durable.
- `/tmp/hq-f5-briefs/{taste,common}.md`: the lead's read-only briefs (not copied into the repo).
- Nothing uncommitted in the worktree; no stash; no background process; the dev server on port 5284 was stopped before the pause and nothing else of mine is running.
- Seeding recipe (no demo path ships): Playwright `page.evaluate` imports `/@fs<worktree>/modules/design/app/compose/sources/handoff.ts` and adds items to `tasteQueue` (data-URL PNGs); `interact.mjs` patches `tasteEnv().client.submit` for the failed/unknown scenarios.
