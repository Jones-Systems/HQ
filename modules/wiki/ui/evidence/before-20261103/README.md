# Before evidence: Wiki and Settings (2026-11-03)

Authority effect: none. Lane F6 captures of the unchanged candidate, taken before any redesign. They support the
[flow assessment](../../flow-assessment-20261103.md).

| Item | Value |
| --- | --- |
| Candidate | `work/hq-foundation` at `0cd50ab` |
| Surface | Real desktop renderer (`apps/desktop/index.html` → `src/main.tsx`) served by Vite 8.3.4 on loopback, with synthetic `window.hqServices` / `window.hqUpdates` bridges installed before the app (lane scratch harness, kept outside the repository) |
| Data | `modules/wiki/ui/fixtures/synthetic.ts` only (invented pages); invented Settings states. No real corpus, account, host or credential |
| Browser | Headless Chrome 156 over CDP, isolated temporary profile, 1280×820 CSS px, scale 1 |
| Fonts | Sans stack pinned to Liberation Sans, because this host maps `sans-serif` to a monospace face |
| Not covered | Electron and preload, macOS rendering, screen readers, forced colours, text-size changes, animation timing |

## Wiki

| File | Shows |
| --- | --- |
| `wiki-01-home.png` | Home: provenance tables for both repositories, header with nine controls and the glyph toggle |
| `wiki-02-search-typed-not-submitted.png` | A typed query does nothing until Search is pressed |
| `wiki-03-search-results.png` | Results after submit: raw scores, paths, snippets |
| `wiki-04-reader-top.png` | Reader opening with namespace, path and a provenance table before the content |
| `wiki-05-reader-lower.png` | Reader body at full width (long line length) |
| `wiki-06-reader-backlinks.png` | Out-links and backlinks at the bottom of the page, without previews or context |
| `wiki-07-topics.png` | Topics as a long path tree |
| `wiki-08-history-open.png` | Session history as a raw list of destination strings |
| `wiki-09-disambiguation.png` | Disambiguation as a separate page with paths only |
| `wiki-10-dark-history.png` | Dark appearance with history open |
| `wiki-11-down-home.png` | Service failing: duplicated red error panels with raw codes, no Retry or Settings route |
| `wiki-12-down-search.png` | Search while the service fails: the same dead-end panels |
| `wiki-13-no-bridge-home.png` | No Wiki bridge in this window |

## Settings

| File | Shows |
| --- | --- |
| `settings-01-data-sources.png` | Data sources: one long page mixing services, Wiki, projects and Jones |
| `settings-03-data-sources-wiki.png` | Local Wiki section further down the same page |
| `settings-04-appearance.png` | Appearance: text toggle for theme, palette cards |
| `settings-05-appearance-lower.png` | The long colour editor, always open |
| `settings-06-updates.png` | Updates |
| `settings-07-data-sources-dark.png` | Data sources in dark appearance |
| `settings-08-wiki-not-set-up.png` | Wiki not configured: rows without an action that fixes them |
