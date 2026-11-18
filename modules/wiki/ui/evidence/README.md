# Wiki UI browser evidence

Isolated-view evidence for `task.wiki-ui.001`. It proves the Wiki view over **synthetic fixtures** in the T3
Browser. It does **not** prove the mounted HQ shell, Electron, the preload/IPC host, a real source, or an
installed app.

## Candidate and build correspondence

| Item | Value |
| --- | --- |
| Base (accepted contract) | `76a1dbc6dd8ed1eb56400fbb9e18bc4e621038a9` |
| Served candidate | `cbd71afee015a9f57c9f7c54fe622a70fd5b5f40` (clean worktree, `git status` empty before and during the run) |
| `modules/wiki/ui` tree at candidate | `8f5c66bb71f8eed6e8c11529a90c23f6b1d0c4a5` (`src/`: `17c76b08da465a76aeebad07631a1029df702cca`) |
| Server | `vite` 8.3.4 dev server, `modules/wiki/ui/harness/vite.config.ts`, explicit `127.0.0.1:5199`, `strictPort`, HMR off, no browser auto-open |
| Build receipt | none. There is no production build: Vite serves Vite-transformed source from the clean worktree, so served bytes are not byte-identical to the committed files. Correspondence is "dev server over the clean candidate tree", not an attestation. |

The PR head adds only this file, `README.md` and the screenshots on top of the candidate; `src/`, `fixtures/`,
`test/` and `harness/` are unchanged from `cbd71af`. An earlier partial capture run at `93c4c86` was discarded
(the topic toggle glyph rendered as a placeholder box and out-links showed a doubled "(missing)" marker);
every screenshot here is from `cbd71af`.

## Route, viewport and fixture

- Route: product-native T3 Browser (`preview_*` tools) in an **incognito** tab; no other automation system.
- Viewport 1280×960 CSS px, device pixel ratio 2. Screenshots are the visible viewport (PNG at 2x).
- Theme: the harness passes `appearance="light"|"dark"` to the view (`data-appearance`); the OS/browser colour
  scheme was not emulated. Content text is identical in both themes.
- Fixture: `fixtures/synthetic.ts` (invented names/text; 71 pages across `bl` and `appdev`, validated against the
  accepted contract validators in `test/fixtures.test.ts`). The harness "shell" echoes requested destinations and
  refuses ones over 512 characters, like the mounted shell.

## Captures

| View | Light | Dark |
| --- | --- | --- |
| Home (listSources + indexStatus) | `light-01-home.png` | `dark-01-home.png` |
| Search (both repositories) | `light-02-search.png` | `dark-02-search.png` |
| Search with repository filter (App Development unchecked) | `light-03-search-filter.png` | `dark-03-search-filter.png` |
| Reader, parsed (top / lower part) | `light-04-reader-parsed.png`, `light-04b-reader-parsed-lower.png` | `dark-04-reader-parsed.png`, `dark-04b-reader-parsed-lower.png` |
| Disambiguation (ambiguous link) | `light-05-disambiguation.png` | `dark-05-disambiguation.png` |
| Backlinks | `light-06-backlinks.png` | `dark-06-backlinks.png` |
| Topics tree | `light-07-topics.png` | `dark-07-topics.png` |
| Reader, raw (`frontmatter-unsupported`) | `light-08-reader-raw.png` | `dark-08-reader-raw.png` |
| In-session history list | — | `dark-09-history.png` |

Flow (light): Home → search "pricing" → uncheck App Development → open BusinessLessons "Pricing" → click the
ambiguous "Onboarding" link → Back → open "cash flow" (backlinks) → Topics · BusinessLessons → open the raw
sample. Dark: switch the harness to Dark, then Back/Forward through the same history, re-checking App
Development for the unfiltered search and re-opening the ambiguous link.

## Readbacks (single page session, no reload)

- Search for "pricing" showed 5 of 5 matches including two distinct same-title "Pricing" hits
  (BusinessLessons, App Development) and two exact-name matches. With App Development unchecked: 3 hits, all
  BusinessLessons, `checked = [bl:true, appdev:false]`.
- Ambiguous link opened the disambiguation panel ("“Onboarding” matches 2 pages") and made **no** shell request
  (harness request counter unchanged at 2); history then showed 4 entries.
- Navigation requests recorded by the harness shell were only logical destinations
  (`search?q=pricing`, `page/bl/...`, `topics/bl`).
- **Network:** `performance.getEntriesByType('resource')` listed 34 entries, all with origin
  `http://127.0.0.1:5199`; no non-local entry. Page-level spies on `window.open`, `fetch`,
  `XMLHttpRequest` and `WebSocket` recorded **zero** calls across the whole session.
- **External text cannot navigate:** dispatched clicks on every external-URL and missing-target element and a
  real Browser click on an out-link external URL left `location.href` unchanged, opened no tab, and made no
  request. `.wiki-view` contained 0 `a` elements, 0 `[href]`, 0 `script/iframe/img/object/embed`, 0 inline
  `style`/event-handler attributes; the script-looking fixture text rendered as text and `window.__wikiPwned`
  stayed unset. External URLs and missing targets are `span` elements, not buttons.
- Raw page text was shown verbatim in `pre.wiki-raw-text` with its reason note.

## Limits

Source-completion and isolated-view evidence only. Not covered: mounted shell, Electron/preload/IPC host,
production CSP (the harness serves the stylesheet as a file, like the CSP requires, but Vite dev injects its own
CSS and loads `@vite/client`), real or private sources, performance on very large pages/trees, screen-reader
behaviour, narrow viewports, or any installed app. The harness "shell" is not the HQ shell. Light/dark are the
view's own appearance prop, not OS emulation. The Browser tab and the temporary listener were stopped after
verification.
