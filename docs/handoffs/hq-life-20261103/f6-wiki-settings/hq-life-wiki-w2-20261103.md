# Handoff: Wiki builder W2 (lane F6), reader and topics browser

Paused at the owner's request on 2026-11-03. Everything done so far is committed and pushed; nothing is held back.

## Where things are

- Branch: `work/hq-life-wiki-w2-20261103`, based on `work/hq-life-wiki-settings-20261103` @ `d2711c7`.
- Worktree: `/home/malcolmjones/.t3/worktrees/HQ/work-hq-life-wiki-w2-20261103`.
- Code head before this handoff file: `1560471` ("WIP: move the failed-refresh bar into the article column…"). The handoff commit sits on top of it; its SHA is in the final message.
- Commits on the branch, oldest first:
  - `7ee994e` redesign of the reader and topics browser (the bulk of the work, includes test updates).
  - `f6a773d` polish after the first screenshot pass, plus the two B5 seams (see "Lane lead addendum").
  - `1560471` (WIP) bar notice moved into the article column, rail kept quiet in a total outage.
- Not pushed anywhere else. No PR opened, nothing merged, no other branch touched.

## Status by design section (`modules/wiki/ui/design-20261103.md`)

| Section | State | Notes |
| --- | --- | --- |
| Reader: page header, meta row, properties | Done, seen in light | Title `h1`, one muted meta line (repository button → topics, folder, 7-char commit), properties grid (max 6, "Show all N properties", a `title` field that repeats the page title is hidden), "Page details" disclosure with repository/path/12-char commit/size. |
| Reader: content typography | Done, seen in light | 16 px / 1.65 reading column, `72ch`; headings re-levelled (leading depth-1 heading equal to the title is dropped, shallowest remaining becomes h2); lists, quote, fence, table, inline code. |
| Reader: link kinds | Done, seen in light | Page = button; ambiguous = dotted button with a count badge; missing = dashed `span` (tabbable, `aria-description`); external = `span` with icon. No `href`, nothing opens. |
| Reader: link previews | Done, seen in light (page, ambiguous, external, rail out-link, backlink); missing frame not captured | 350 ms hover / 500 ms focus / 120 ms close grace, one at a time, `aria-hidden`, Escape and scroll close, prefetch through `ctx.cache.prefetch` with the same descriptors. CSS anchor positioning with an `@supports not` fallback. |
| Reader: outline | Done, seen in light | `nav[aria-label="On this page"]`, h2/h3 with ids `wiki-h-<n>`, smooth scroll (instant under reduced motion or `data-hq-motion="reduce"`), current section by IntersectionObserver (guarded when absent). |
| Reader: backlinks with context | Done, seen in light | Rail section "Linked from (N)", row preview shows the sentence / list item / heading / table row that links here (lazy, cached). Truncation text kept. |
| Reader: out-links | Done, seen in light | Grouped Pages / Ambiguous / Missing / External with counts, de-duplicated, "Show all N links" past 8. |
| Reader: raw pages | Done, shot is stale | Info notice "Shown as plain text" with the reason in muted mono, verbatim `pre`. Raw-note text size was fixed after the shot. |
| Reader: disambiguation | Done, shot not yet reviewed | Card list with lazily loaded titles, ArrowUp/Down/Home/End focus movement. |
| Topics browser | Done, seen in light | Segmented repository control, "Filter topics", Expand/Collapse all, chevron disclosures, `pageName(path)` + muted folder rows, "and N more", two levels open by default, no state leaking between repositories. |
| Feedback rules (in-place failures) | Done in code; shots partly stale | Not-found: "This page isn’t in <repo>" with Search for “name” and Back. Outage: ErrorNotice with Retry and Wiki settings (only when `ctx.openSettings` is non-null). Backlinks failure: bar notice with Retry, page stays. Failed refresh of a cached page: bar notice with Retry above the page. Toasts through `outage.ts`. |
| Motion | Done in CSS; not yet verified in strips | `wiki-rise` (content replacing a skeleton), `wiki-pop` (preview), `wiki-expand` (grid-rows height for topic expansion, only opening animates), reduced-motion blocks. All durations from `--hq-duration-*` tokens. |
| Keyboard | Done in code | Escape closes a preview (capture listener, stops propagation); outline buttons; topics tree arrows, Home/End, Left/Right, ArrowDown from the filter, Escape clears the filter; disambiguation arrows. |
| Accessibility | Done in code | Previews `aria-hidden` and never take focus; `aria-current="location"` in the outline; `aria-expanded` on toggles and on "Show all"; `role=status` loading lines. |

## WF findings (`flow-assessment-20261103.md`)

- WF-2 (reader parts): addressed in code. Not-found, outage and backlinks failures show in place with recovery actions; Settings only when injected. Not covered by new tests yet.
- WF-3: addressed. Title no longer appears twice, provenance moved behind "Page details", frontmatter is a properties grid, reading column is about 72 characters wide.
- WF-4: addressed. Links sit in a right rail (outline, linked from, links on this page), previews exist for page / ambiguous / missing / external / backlink rows, backlinks show how the page is mentioned, out-links are grouped and de-duplicated.
- WF-7: addressed. No repeated repository badge, rows are named from the path with the folder muted, two levels open by default, chevron toggles with animated opening.
- WF-9 (disambiguation): addressed in the reader by the ambiguous preview (lists the candidates) and a card-style Disambiguation view with lazily loaded titles. Choosing still means opening the Disambiguation view first; the design did not ask for inline choosing.
- Motion: the brief called this WF-11, but in the assessment file it is WF-10 ("Feedback / aliveness"); WF-11 there is "Shell integration". I treated both: motion as above; Settings-from-failure and recent-page recording (`ctx.session.visit` on load, `rememberTitle` for backlink entries) as the reader side of WF-11. The recent-page behaviour has no test yet.
- WF-12: partly. Chevron disclosures instead of +/− glyphs and keyboard movement in topics and disambiguation are done. Focus-to-title after navigation belongs to W1's `view.ts` (the reader's `h1` has `tabIndex={-1}` for it). Narrow-width header wrapping is W1's.

## Decisions and why

- **Spans for preview cards** (`span.wiki-preview[aria-hidden]`): a `div` inside a `<p>` makes React warn. Cards are `position: fixed` inside `.wiki-view`; `container-type` on `.wiki-reader` gives containment so `.wiki-scroll` cannot clip them. No portals and no `style` attributes (the static test forbids both); the anchor is a class (`wiki-anchor-on`) toggled on the active link.
- **External URL moved out of the sentence.** The inline link shows only its words; the URL is in the preview and in the out-link list (`.wiki-external-url`). The old test asserted the URL in the sentence; I changed it to assert the URL stays visible as text elsewhere (see test changes).
- **Container query at 860 px of reader width** (about a 1100 px window) for the three-column layout; below it the rail's sections move under the article. This is a deviation from "~900 px narrow" thinking in the brief: at 900 px window the rail is below. The narrow frame has not been taken.
- **`backOf(ctx)` helper** (`recovery.ts`) clicks the chrome's `button[aria-label="Back"]` when `session.nav.index > 0`, because `ViewCtx` has no `back`. This depends on W1 keeping that label.
- **Failed-refresh bar lives in the article column** (`1560471`); during a total outage (page and backlinks both failed with an outage) the rail's backlinks section shows no notice of its own, so one outage produces one notice plus the toast.
- **`Loading`, `ErrorPanel`, `Async` stay in `common.ts`** because W1's files still import them. Remove once W1 migrates.
- **Standalone Disambiguation drops W1's panel border** with `.wiki-view main > .wiki-disambiguation` (higher specificity than the `.wiki-disambiguation` rule in W1's `wiki-search.css`). It only affects the top-level view; embedded uses keep W1's panel.
- **Summary text** for previews joins blocks with a full stop when a block lacks end punctuation (list items otherwise ran together).
- Keyed remount: `ReaderView` renders `ReaderPage` keyed by page id, so previews, outline and expanded properties never carry between pages.

## Lane lead addendum (B5, received while working)

Done: backlink context is behind one function, `useBacklinkContext(ctx, entry, current)` in `view-preview.ts` (today it reads the source page through the cache and walks its AST; with `BacklinkEntry.excerpt` it can return early without a fetch). `BacklinkPreview` and `BacklinkRow` take the whole `entry`. Topic page labels are behind `topicPageLabel(topic, key)` in `topic-tree.ts` (today `pageName(key.path)`; later `topic.pageTitles?.[i]`). The pure function `backlinkContext(document, target)` in `reader-model.ts` keeps its name. Nothing depends on the B5 fields. W3 is cancelled; ignore it in the design doc.

## Files changed (all under `modules/wiki/ui/`)

- New: `src/reader-model.ts` (pure: `documentHeadings`, `backlinkContext`, `pageSummary`, `groupOutLinks`, `inlineText`, `clip`, `sameText`), `src/view-preview.ts`, `src/view-outline.ts`, `src/view-links.ts`, `src/outage.ts`, `src/recovery.ts`.
- Rewritten: `src/render-ast.ts`, `src/view-reader.ts`, `src/view-topics.ts`, `src/wiki-reader.css`, `src/wiki-topics.css`.
- Modified: `src/common.ts` (Disambiguation as cards; Loading/ErrorPanel/Async kept), `src/topic-tree.ts` (`showTopics`, `filterWords`, `markPieces`, `countShown`, `topicPageLabel`).
- Tests updated: `test/reader.test.ts`, `test/topics.test.ts`, `test/stale.test.ts`.
- Nothing edited in W1-owned or lead-owned files. Nothing outside `modules/wiki/`, except this handoff file (requested by the lead).

## Test changes (every changed assertion; all in `7ee994e`)

Rule followed: a behavioural assertion keeps its strength; only selectors and text that changed by design moved.

`test/reader.test.ts`
1. "shows namespace, path, commit…": `fields('title') === 'Pricing'` → asserts there is no `[data-field-name="title"]` property (a title field that repeats the page title is not a property). Added: `h1.wiki-page-title` text is `Pricing`; meta row children are `['BusinessLessons', 'lessons', 'Commit <7-char>']`; the commit `code` keeps the full commit in `title`.
2. New test "a title field that differs from the page title stays a property; more than six properties collapse" (a `title` of "Pricing, long form" plus 7 fields: 6 shown, "Show all 8 properties" with `aria-expanded`, expand to 8, "Show fewer properties" back to 6).
3. "renders every safe node type…": `h2, h3` list `['H2:Pricing','H3:Models','H3:Inert text']` → `['H2:Models','H2:Inert text']` (leading duplicate title heading dropped, shallowest becomes h2); added: the reader's only `h1` is `Pricing`.
4. Same test: the inert-element query dropped `svg` (the view now draws icons) and a new assertion requires every `svg` to have `data-icon` and `aria-hidden="true"`. The other forbidden-element, `[href]/[src]/[onerror]/[onclick]/[style]` and `__wikiPwned` assertions are unchanged.
5. "missing targets are inert…": `missing.getAttribute('title') === 'Missing target: Churn playbook'` → `aria-description === 'Missing page: Churn playbook'` and `title === null` (no native tooltip competing with the preview). External text `'a pricing study (https://…)'` → `'a pricing study'`, plus a new assertion that the URL text still appears next to the link in `.wiki-outlinks`. The click loop now clicks `.wiki-outlinks .wiki-external-url` instead of the URL inside the inline link; the "no navigation, no requests, no egress" assertions are unchanged.
6. "an ambiguous link opens disambiguation…": candidate button text `['lessons/onboarding.mdBusinessLessons','guides/onboarding.mdBusinessLessons']` → per card `[title, repository, path]` = `[['Onboarding','BusinessLessons','lessons/onboarding.md'],['Onboarding','BusinessLessons','guides/onboarding.md']]`. Back clicks use `button[aria-label="Back"]` instead of the `.wiki-nav` text button.
7. "out-links list every target kind": heading `Links from this page (4)` → `Links on this page (4)`; `(missing: Churn playbook)` text → a group assertion (`Pages1, Ambiguous1, Missing1, External1`) and the missing item's text in its group. Kind order and the ambiguous click are unchanged.
8. "backlinks list who links here": `2 pages link here.` → heading matches `^Linked from \(2\)$`. Row labels and navigation unchanged.
9. "truncated backlinks are labelled": added the heading `Linked from (120)`; the "Showing 1 of 120" assertion is unchanged.
10. Raw-page cases: `Shown as raw text (<reason>)` → note contains `Shown as plain text`, `.wiki-raw-reason` text equals the reason, note `data-tone="info"`. Verbatim `pre` and `data-raw-reason` assertions unchanged.
11. "reader loading and per-code errors": not-found alert is matched by `This page isn’t in BusinessLessons` instead of `Not found`; added `data-code` equals the error code. `data-reason`, no title, and "backlinks still shown" unchanged.

`test/topics.test.ts`
12. Header: `Topics · BusinessLessons` → title is `Topics` and the `BusinessLessons` segment has `aria-pressed="true"`.
13. Page rows: `['lessons/pricing.mdBusinessLessons','lessons/cash-flow.mdBusinessLessons']` → `[['Pricing','lessons'],['Cash flow','lessons']]` through `.wiki-topic-inner`; new assertion: no repository badge repeated on every row.
14. Archive: added the first row's name is `Entry 01`; the 50 buttons and "and N more" assertions unchanged.
15. "a previewed page opens in the reader": click target `guides/onboarding.mdBusinessLessons` → `Onboardingguides`; the logical destination assertion is unchanged.
16. Repository switcher: `.wiki-topics .wiki-button` → `.wiki-segment`; dropped the `Topics · App Development` title assertion (the title is now just `Topics`; the pressed segment covers it); added the `BusinessLessons` segment is `aria-pressed="false"` while App Development is active. Tree contents, destinations and "fresh tree at default" are unchanged.
17. "topic requests are valid logical requests": segment selector only.

`test/stale.test.ts`
18. `nav()` helper (`.wiki-nav` text buttons) → `back()` using `button[aria-label="Back"]` and `shown()` reading the `main > [aria-label]` label.
19. Reader stale page: `.wiki-crumbs code` → `[data-field="path"] dd` (same value `lessons/cash-flow.md`).
20. "going back while a request is in flight": navigation uses `app.external('topics/bl')`, and Home is identified by the `Home` label instead of counting `.wiki-card` (count 2). Loading state, late-response-not-mounted and back-to-Home assertions keep the same strength.
21. "revisiting a destination": previously "loads it fresh" (second visit shows the second answer). Now: a revisit inside a minute does not ask again and shows the cached list at once (`loads === 1`); with `Date.now` mocked +61 s the revisit asks again (`loads === 2`) and shows the second answer. This follows the base's 60 s cache rule, not a UI choice.

### Tests that now fail, owned by W1 (not edited by me)

Proposed fixes, for whoever owns those files:
- `test/navigation.test.ts:16`: row text `'lessons/pricing.mdBusinessLessons'` → `'Pricinglessons'`.
- `test/navigation.test.ts` ~115: `.wiki-crumbs code` → `.wiki-reader [data-field="path"] dd`.
- `test/search.test.ts:122`: candidate text `['lessons/onboarding.mdBusinessLessons','guides/onboarding.mdBusinessLessons']` → `['OnboardingBusinessLessonslessons/onboarding.md','OnboardingBusinessLessonsguides/onboarding.md']` (title, repository, path).

## Checks

All commands run from the worktree root unless a `cd` is shown. CPU sampled before running: `uptime` and `top -bn1 | head -5` showed ~43% busy (below the 85% bar).

- `cd modules/wiki && npm test`: on HEAD `1560471` code, 539 tests, 536 pass, 3 fail (the three W1 tests above), 0 skipped, about 5.0 s. Earlier targeted run of the reader, topics, stale and static tests: 67 of 67 passed.
- `npx tsc -p modules/wiki/tsconfig.json --noEmit`: exit 0, but run on `f6a773d` content; **not re-run on `1560471`** (the edit after it touched `view-reader.ts` and `view-links.ts`).
- Root `npm run typecheck`: **not run**.
- Pre-existing issue: `tsc -p modules/wiki/ui/tsconfig.json` from the repo root reports `base.test.ts(109,22)` TS2322 in a lead-owned file; the same command from `modules/wiki/ui` prints nothing. I did not touch it.
- No new tests were written yet (see "Left to do").

## Screenshots (all outside the repo; none committed)

Harness and outputs exist only in `/tmp` (see "Only here" below). Light mode, 1280×820, synthetic data, old W1 chrome visible around the reader:

- Directory `/tmp/hq-f6-w2-shots/light/`:
  - Reviewed and acceptable: `reader-top.png`, `preview-backlink.png`, `reader-rail.png`, `hub-top.png`, `preview-ambiguous.png`, `preview-external.png`, `preview-page.png`, `preview-rail-outlink.png`, `not-found.png`, `outage-reader.png`, `topics-filtered.png`, `topics-expanded.png`.
  - Taken but not reviewed since the last CSS edits: `disambiguation.png`, `outage-recovered.png`, `topics-default.png`, `topics-collapsed.png`, `topics-appdev.png`.
  - Stale (taken before later fixes; retake): `raw-page.png` (raw-note text size), `outage-cached.png` (bar was above the layout, rail showed its own verbose notice), `preview-missing.png` (no card showed: the harness hovered the middle of a link that wrapped across two lines; the harness paragraph was re-ordered afterwards, rerun `s2-hub.json`).
- `/tmp/hq-f6-w2-shots/t1/` and `/tmp/hq-f6-w2-shots/probe/`: earlier trial frames, superseded.
- Visual defects found and fixed in `f6a773d`/`1560471` (not re-shot): rail rows too tall, outline active bar curved, sticky rail flush against the top, notice actions squeezing the text, backlinks notice overlapping its own buttons in the rail, nested panel around disambiguation, raw-note body text too large, run-on preview summary.

## Left to do, in priority order

1. **Re-verify HEAD.** `npx tsc -p modules/wiki/tsconfig.json --noEmit`, `cd modules/wiki && npm test` (expect only the three W1 failures), root `npm run typecheck`. Sample CPU first.
2. **Write the new behaviour tests** (none exist yet). Suggested files and notes:
   - `ui/test/reader-model.test.ts` (pure): `documentHeadings` ids/levels/duplicate-title skip/outline h2–h3 only; `backlinkContext` for sentence, list item, heading, table row, several mentions, no link; `pageSummary` including the list-item full stops; `groupOutLinks` de-duplication and order; `showTopics`, `markPieces`, `filterWords` (ancestors kept, label match shows all pages, no match). Fixture builders `text, code, em, link, para, heading, key` are exported from `ui/fixtures/synthetic.ts`.
   - `ui/test/preview.test.ts`: store unit tests with `createPreviewStore({hover:10, focus:20, close:5})` for delays, one at a time, Escape (capture listener, `stopPropagation`), scroll, blur, "stays while hovered"; integration with the default constants (`HOVER_DELAY_MS` 350, `FOCUS_DELAY_MS` 500) using real timers. React derives `onMouseEnter/Leave` from `mouseover/mouseout`, so dispatch those (bubbling, no `relatedTarget`); for focus dispatch `focusin`/`focusout` if `focus()` does not trigger React in happy-dom. Do not mock `setTimeout` globally: `settle()` in `render.ts` needs it. Content per kind (page summary, ambiguous candidates, missing "No page named “X” yet", external URL + "External links don’t open from the Wiki."), card is `aria-hidden`, a click inside a preview navigates nowhere, hover calls `getPage` once for the target and opening the page afterwards makes no second call (same cache key), backlink row preview shows the marked sentence.
   - `ui/test/outline.test.ts`: ids `wiki-h-<n>`, click scrolls the heading (stub `scrollIntoView` on the happy-dom element prototype; `smooth` normally, `auto` under `data-hq-motion="reduce"`), focus lands on the heading, `aria-current` follows an `IntersectionObserver` stub.
   - `ui/test/recovery.test.ts`: Retry after a failed page load; a failed refresh keeps the page and shows the bar with Retry (use `Date.now` +61 s as in `stale.test.ts`); not-found shows "Search for “name”" and Back; outage shows Retry and "Wiki settings" only with `launch({affordances:{openSettings}})`; toasts through an injected port: warning once per episode, error on a failed retry, success on recovery; backlinks failure alone shows a small bar with Retry while the page stays; page and backlinks both failing shows one notice (the `quiet` rule).
   - Recent pages: `ctx.session.visit` on load and `rememberTitle` for backlink entries. I did not check how a test can reach the session from `launch()`; look at `src/session.ts` and `createWikiView`, or assert through the sidebar's recent list, or ask the lead for a handle.
   - Topics: filter keeps ancestors and marks matches, no-match state, Escape clears, ArrowDown from the filter, arrow/Left/Right/Home/End on the tree, expansion resets between repositories (already covered), animated state only on opening.
   - Disambiguation keyboard (ArrowUp/Down/Home/End, Enter).
3. **Screenshot matrix**, light and dark, committed to `modules/wiki/ui/evidence/after-20261103/w2/` with a README table. Missing frames: everything in dark; the missing-link preview; narrow ~900 px (run the hub steps with `--width 900`); the 6–8 frame strips (`s7-strips.json` is written but never run); retake the stale frames above; review `disambiguation.png`. Driver steps for all frames exist as `/tmp/hq-f6-w2-harness/s1-reader.json` … `s7-strips.json`.
4. **Fix whatever the dark and narrow passes show.** Not yet looked at: dark colours for marks, chips, notices and the preview card; the `@supports not (anchor-name: --a)` fallback (never rendered; the harness Chrome supports anchor positioning); a preview near the bottom or right edge (flip fallbacks never exercised); wrapped inline links (card anchors to the union box).
5. **Final report** in the brief's format (branch + head SHA, files, WF findings, changed assertions, base needs, checks, screenshot paths, deviations, open issues). Most of it is in this file.

## Base-file needs (not edited by me)

- `ViewCtx.back` (or a history handle): `backOf` currently clicks the chrome's Back button.
- A shared outage-toast helper in the base: `src/outage.ts` is mine and uses the base toast id `wiki-outage`; other views will want the same behaviour.
- The pre-existing type error at `ui/test/base.test.ts:109` (see Checks).
- When W1 stops importing `Loading`, `ErrorPanel` and `Async` from `common.ts`, they can go.

## Open questions and risks

- Do W1's chrome and the real app keep `button[aria-label="Back"]` and a scroll container that sticky positioning and `IntersectionObserver` can use? The outline looks for `.wiki-scroll` as the observer root and falls back to the viewport; in the harness the scroller is `.wiki-domain` and the fallback worked.
- The 860 px reader-width threshold (≈1100 px window) is my choice. At 900 px the rail goes under the article; check it looks right (frame not taken).
- The three W1-owned failing tests will stay red on this branch until W1 updates them.
- Rail sticky `max-height: calc(100vh - 120px)` is a guess for the chrome height.
- B5's optional fields are not on this base; the validators here reject them. The two seams are ready, but nothing exercises the future path.

## Only here (not in the repository)

- Harness, all in `/tmp/hq-f6-w2-harness/`: `vite.config.mjs` (serves the real HQ desktop renderer from this worktree; its HTML substitution was fixed to match `main.tsx?t=…` after hot reloads), `shoot.mjs` (headless Chrome driver), `fakes.ts` (synthetic `window.hqServices` plus **harness-only fixtures**: a "Link hub" page with 8 properties, headings, a table, a fence, ambiguous/missing/external links and a link to a page that does not exist, and extra topics "Reader samples", "Tier design", "Per-seat tiers"), `s1-reader.json` … `s7-strips.json`, `steps-*.json`, `mk.py`.
- Start the server: `HQ_WORKTREE=/home/malcolmjones/.t3/worktrees/HQ/work-hq-life-wiki-w2-20261103 HQ_PORT=5253 nohup npx --prefix /home/malcolmjones/.t3/worktrees/HQ/work-hq-life-wiki-w2-20261103 vite --config /tmp/hq-f6-w2-harness/vite.config.mjs > /tmp/hq-f6-w2-server.log 2>&1 &`. Check `curl -s http://127.0.0.1:5253/ | grep -c fakes` prints 1. Run a step file: `node /tmp/hq-f6-w2-harness/shoot.mjs --url http://127.0.0.1:5253/ --out <dir> --steps /tmp/hq-f6-w2-harness/s2-hub.json --settle 6000 [--scheme dark] [--width 900]`. Use a longer `--settle` when the machine is busy. Do not use `pkill -f` with a pattern that appears in your own command; find the pid with `ss -ltnp | grep :5253`. Port 5253 is stopped now.
- Screenshots in `/tmp/hq-f6-w2-shots/`.
- `node_modules` in the worktree was copied from the sibling settings worktree (gitignored).
- The harness fixtures are not part of `ui/fixtures/synthetic.ts`; tests that need such pages should build them with `override(base, …)`.
- The worktree is clean after the handoff commit; there is no stash and no uncommitted work.
