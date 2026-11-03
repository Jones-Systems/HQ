# Wiki and Settings flow assessment (2026-11-03)

Authority effect: none. Lane F6 (Wiki module and app Settings). This assessment records what the current
`work/hq-foundation` candidate does for the owner's core flows, where it breaks or slows them, and what the
redesign must fix. It is the input to the build; the target design lives in
[`design-20261103.md`](design-20261103.md) (Wiki) and
[`docs/design/settings/hq-settings-design-20261103.md`](../../../docs/design/settings/hq-settings-design-20261103.md)
(Settings).

## Evidence basis

| Item | Value |
| --- | --- |
| Candidate | `work/hq-foundation` at `0cd50ab` (lane branch `work/hq-life-wiki-settings-20261103` before any change) |
| Surface | The real desktop renderer (`apps/desktop/index.html` → `src/main.tsx`, real `App`, real modules) served by Vite 8.3.4 on loopback, with synthetic `window.hqServices` / `window.hqUpdates` installed first (lane scratch harness, outside the repository) |
| Wiki data | `modules/wiki/ui/fixtures/synthetic.ts` (71 invented pages across `bl` and `appdev`), 90–210 ms simulated latency; `?wiki=down` (every read fails `unavailable/source-unavailable`) and `?wiki=none` (no bridge, sources not configured) variants |
| Browser | Headless Chrome 156 via CDP, isolated temporary profile, 1280×820 CSS px, scale 1, light and dark `prefers-color-scheme` |
| Fonts | The host has no system sans font (fontconfig maps `sans-serif` to Liberation Mono), so the harness pins `--hq-font-family-sans` to the installed Liberation Sans for both before and after captures. macOS renders the token stack's `system-ui` fallback instead |
| Not covered | Electron, the preload bridge, a real Wiki corpus, macOS rendering, screen readers, forced colours, text-size changes |

Before screenshots: [`evidence/before-20261103/`](evidence/before-20261103/README.md).

## Integration check: is the Wiki in the shell?

Yes. On this candidate the rail lists **Design, Social, Work, Wiki** (`DOMAIN_IDS` in `@hq/contracts`), the module is
registered in `apps/desktop/src/modules.tsx` with `presentation: 'fill'`, the rail's Data sources block reports Local
Wiki status, and `apps/desktop/src/wiki.integration.test.tsx` mounts the real `App` over the real host. The
three-item rail in the visual-system screenshots is historical (those mockups predate the Wiki domain). Remaining
integration gaps are listed under WF-10 and WF-11; no rail change is needed.

## Flow 1 — Wiki: search → read → follow links/backlinks → browse topics → view history

### What works

- Every read goes through the seven-method contract with request guards, response validation and a stale-response
  sequence guard; hostile Markdown renders as inert text; external URLs are never opened. These safety properties
  are the foundation for the redesign and must be preserved.
- Same-title pages in different repositories stay distinct; ambiguous links lead to a disambiguation choice; missing
  targets are visibly missing.
- In-session Back/Forward works, and leaving for Settings and returning keeps the Wiki exactly where it was.

### Findings

Impact: **High** blocks or badly slows a core flow; **Medium** clear friction or confusion; **Low** polish.

| ID | Impact | Flow step | Finding | Evidence |
| --- | --- | --- | --- | --- |
| WF-1 | High | Search | Search only runs on submit. Typing shows nothing until Enter or the Search button; there is no type-ahead, no keyboard movement through results and no shortcut to reach the field. The best-in-class baseline (Raycast, Linear ⌘K, Obsidian quick switcher, Notion search) is instant results as you type with arrow-key selection. | `wiki-02-search-typed-not-submitted.png`, `wiki-03-search-results.png` |
| WF-2 | High | First open / failure | When the Wiki is not set up or its host fails, Home and Search replace the content with one large red panel *per request* (“Source unavailable … (repository list)”, “… (index status)”), raw codes (`unavailable · source-unavailable`), no Retry and no route to Settings. The rail meanwhile says “Local Wiki · Not set up”. A first-time user hits a dead end. | `wiki-11-down-home.png`, `wiki-12-down-search.png`, `wiki-13-no-bridge-home.png` |
| WF-3 | High | Read | The reader leads with a provenance table (Repository, Path, Commit, Size) and a raw frontmatter dump before any content; the title then appears twice (page title and the document's own first heading). Text runs the full 1,080 px width (≈150 characters per line) inside a bordered box, at the 13 px interface size. Reading is the main job and is the hardest part to do. | `wiki-04-reader-top.png`, `wiki-05-reader-lower.png` |
| WF-4 | High | Follow links / backlinks | Backlinks and outgoing links sit at the very bottom of the page, after all content, as plain lists; backlinks give only a title and path, no context of *how* the page is mentioned. There are no link previews, so every check of a link is a full navigation and a Back. The outgoing-link list repeats the inline links. | `wiki-06-reader-backlinks.png` |
| WF-5 | Medium | Navigation chrome | The header spends ~150 px on a title, six bordered buttons (Back, Forward, Home, two hard-coded “Topics · <repo>” buttons, History) and a separate row holding only a show/hide toggle drawn with the ⌃/⌄ keyboard glyphs (missing from common fonts, rendered as a box here). There is no breadcrumb showing where a page sits. The rest of HQ uses a compact secondary navigation instead. | `wiki-01-home.png` |
| WF-6 | Medium | Home | Home is a provenance dump: two cards of ref/commit/ISO-timestamp rows (`2026-10-01T06:00:12.250Z`). It offers no way into content except “Browse <repo> topics”: no recent pages, no topics overview, no search prompt. A “Loading repositories…” line also stays above loaded cards while the second request finishes, so the cards jump. | `wiki-01-home.png` |
| WF-7 | Medium | Browse topics | Topics is a long expanded tree whose leaves are file paths with a repeated repository badge on every row (the contract carries page keys only); a 60-page archive opens expanded by default. Switching repository uses a second button row. Expand/collapse is instant. | `wiki-07-topics.png` |
| WF-8 | Medium | View history | “History (n)” opens a numbered list above the page of raw labels (`Page · bl/lessons/pricing.md`, `Disambiguation · Onboarding`). It is session navigation only; there is no page revision history or diff in the contract. Session history is lost whenever the user switches domain (the module remounts). | `wiki-08-history-open.png` |
| WF-9 | Medium | Disambiguation | Clicking an ambiguous link navigates to a separate page that lists bare paths. Choosing among two candidates costs two navigations. | `wiki-09-disambiguation.png` |
| WF-10 | Medium | Feedback / aliveness | Every state change is a hard swap: “Loading …” text replaces content (layout jumps), pages appear without transition, focus jumps to a region rather than the page title, and nothing confirms an action. No motion anywhere, so the product feels static. | all captures |
| WF-11 | Low | Shell integration | The Wiki never asks the shell to open Settings for setup, and its search-bar preference is the only Wiki state that persists; the repository filter, recent pages and history do not. | source review |
| WF-12 | Low | Keyboard and a11y | No shortcuts (search, back/forward), results are not a listbox, the main region (not the title) receives focus after navigation, topic toggles use “+”/“−” text glyphs, and narrow widths wrap the header buttons into several rows. | source review |

## Flow 2 — Settings: change settings, theme and connections

### What works

- Clear entry points: rail Settings, rail Data sources rows (deep link to the source with a highlight ring), the
  Social/Work status-bar “Set up” links, and `hq-open-settings`. Escape and “← Back to <domain>” close Settings and
  focus returns to the opener. Mounted domains keep their state while Settings is open.
- Endpoint values are never read back into the renderer; Wiki source removal requires confirmation; Updates is
  careful about consent and stale candidates. These rules stay.
- Appearance already has a live dark-palette preview with contrast ratios.

### Findings

| ID | Impact | Flow step | Finding | Evidence |
| --- | --- | --- | --- | --- |
| SF-1 | High | Connections | “Data sources” is one long scroll mixing five subsystems: Social and Work service addresses, project-folder and gallery enrollment, seven Jones controls and, last and hardest to find, Local Wiki. Nothing summarises which sources are healthy; the user must scroll and read. | `settings-01-data-sources.png`, `settings-03-data-sources-wiki.png` |
| SF-2 | High | Local Wiki setup | A not-set-up repository row shows only “bl · Not set up” with no action; the only entry is a generic “Import source profile…” at the top of the card. Namespaces appear as raw ids (`bl`, `appdev`) while the Wiki calls them BusinessLessons and App Development. Results of Import, Save, Reindex and Remove appear as small status text at the bottom of the card or not at all, so the user cannot tell whether an action worked. | `settings-03-data-sources-wiki.png`, `settings-08-wiki-not-set-up.png` |
| SF-3 | Medium | Forms | Project-source and Jones forms run label and input together on one line (“Gallery label[ ]Gallery base URL[ ]”) at a larger default label size than the rest of the page; some buttons stretch full width. Four Jones buttons are disabled with no reason on hover or focus, contrary to the unavailable-actions standard. Status text shows raw enums (`not-configured · unqualified`, `kind · state · generation N`). | `settings-03-data-sources-wiki.png` |
| SF-4 | Medium | Category switching | Categories share one scroll container, so switching keeps the previous offset: after scrolling Data sources, Appearance opens part-way down its colour list. Categories have no icons or summaries. | `settings-04-appearance.png` |
| SF-5 | Medium | Feedback | Success is silent (save address, check connection, recheck, reindex) or shown only as a line of text that may be off screen; failures are generic (“Could not complete this action…”). A service address change says “reload HQ” but offers no clear post-save state. | source review, `settings-01-data-sources.png` |
| SF-6 | Medium | Theme | Theme is three text toggles; Light/Dark/System are not shown visually, and switching snaps the whole window with no transition. The rail button cycles themes without telling you what changed. | `settings-04-appearance.png`, `settings-05-appearance-lower.png` |
| SF-7 | Low | Recheck controls | Recheck and reindex use the ↻ text glyph (missing from common fonts; a box here) instead of the SVG icon set the rail uses. | `settings-03-data-sources-wiki.png` |

## Cross-cutting conclusions

1. **Search and reading are the product.** The Wiki should open on a search-first home, answer as you type and
   present pages as a comfortable reading column, with provenance available but secondary.
2. **Links should be explorable without leaving the page**: hover/focus previews for links and backlinks,
   backlinks with the sentence that mentions this page, and in-place disambiguation.
3. **Failures belong in context.** Replace full-screen error panels with inline indicators on the affected card,
   list or page (with Retry and, when setup is the cause, an “Open Settings” action) plus toasts for transient
   action results. Keep the last good content visible while reloading.
4. **Motion should explain change**: results fading in as you type, page crossfades, expanding trees, preview cards,
   theme crossfade, using the shared duration/easing tokens and removed under `prefers-reduced-motion`.
5. **Settings needs structure, not more text**: an at-a-glance status summary for every data source, one panel per
   subsystem, setup actions on the rows they affect, consistent field layout, explained disabled actions, and
   toasts plus inline state for every action.
6. **Revision history and diffs need backend support.** The current contract has no per-page history. The Wiki can
   make session history useful (titled recents that survive domain switches, a history popover) and surface source
   freshness, but revision history/diffs must come from backend lane B5 as a contract addition; the redesign leaves
   a clearly owned slot for it rather than a dead control.

## Best-in-class references used

| Product | Pattern borrowed | Applied to |
| --- | --- | --- |
| Raycast, Linear ⌘K | Instant type-ahead list, arrow keys, Enter to open, footer hints | Quick search overlay and live search page |
| Obsidian | Page preview on hover, backlinks with context, outline, recent files | Reader side panel, link and backlink previews |
| Notion | Centered reading column, compact properties block, breadcrumbs | Reader layout and metadata |
| Arc | Smooth page transitions, calm chrome, small confirmations | Page crossfade, toasts |
| Linear settings | Grouped panels with concise rows, icons in the category list, inline saved state, toasts | Settings redesign |
| macOS / Raycast appearance | Visual theme tiles | Settings › Appearance |

## Constraints the build must keep

- Wiki UI rules (`modules/wiki/ui/test/static.test.ts`): React text children only; no `href`, `innerHTML`, portals,
  inline style props, network, Node or Electron APIs; imports limited to React, sibling files and the contract.
  Stylesheets are files scoped under `.wiki-`. These tests may be extended (more stylesheet files, `@keyframes`,
  `@starting-style`, `@supports`), never weakened.
- External URLs stay visible, non-clickable text. Navigation stays a request to the shell.
- Settings never reads endpoint values back, keeps confirmation before removal and keeps the Updates consent rules.
- Shell changes stay minimal and isolated (lane F1 owns the shell and shared motion/feedback primitives).
