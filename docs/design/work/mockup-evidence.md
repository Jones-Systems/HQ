# HQ Work mockup evidence

Artifact Type: `design-evidence`

Artifact ID: `evidence.hq-work-mockup`

Purpose: Record how the Work mockup was rendered, exercised and refined, and what that does and does not prove.

Governing artifact: `brief.hq-work-design`

Decision owner: M Jones

Consumers: T1, WRK-P, WRK-B, the HQ root coordinator

Authority effect: none

## What this evidence is

[`mockups/work-hq.html`](mockups/work-hq.html) is a design mockup with
**fictional data** and an in-page **fixture adapter**. Every check below ran
against that fixture. None of it shows HQ integration, a real Planner service,
installed-app behavior or production code. The fixture follows the Planner
semantics cited in the [inventory](planner-behavior-inventory.md), with two
limits:

- It does not implement request replay or `request_id_reused`.
- Its latency (420 ms) is simulated.

## Opening the mockup

The mockup is one self-contained file with no network requests, fonts or
build step. Open it from any static file server, for example a loopback
`python3 -m http.server`, or directly from disk. These URL parameters set the
starting state:

| Parameter | Values |
| --- | --- |
| `appearance` | `light`, `dark`, `system` |
| `view` | `glance`, `board`, `list`, `calendar`, `timeline`, `review`, `archive` |
| `board` | `status`, `dates` (By date), `lists` (Weekly plan, proposed) |
| `col` | the status shown first at narrow widths, for example `next` |
| `open` | an item ID to open in the detail panel, for example `it-site` |
| `state` | `offline` |
| `mock` | `open` or `closed`: the instrumentation panel |

The **Mockup instrumentation** panel is not product UI. It logs every adapter
call with its request ID and shows `execution calls: 0`. It can make the
fixture unreachable, or simulate an edit from another device.
`window.__workMock` exposes `executionCalls()`, the fixture server and the
client state for scripted checks.

## Environment

- **Browser:** the Jones Code collaborative preview browser (Chromium),
  viewports 1280×800 and 420×860 freeform.
- **Fonts:** this host has only Liberation fonts. The font stack was adjusted
  so system UI fonts win where they exist, and glyphs missing here (such as
  `⋯`, `✓` and `✕`) were replaced with icons or plain text.
- **Telemetry:** taken before the local syntax check. CPU was 4.73% used, with
  38.40 GiB RAM available and a serial test ceiling of 1.

## Checks performed

All checks ran on the 2026-10-20 working copy.

| # | Check | Result |
| --- | --- | --- |
| 1 | Drag a card from Next to Active | One `moveItem` call with a neighbor anchor. Ctrl+Z sent one inverse `moveItem` that restored `after it-news` exactly. |
| 2 | Alt+→ on an Inbox card | The card moved to the top of Considering. Focus stayed on it, and the move was announced. |
| 3 | Alt+→ then Ctrl+Z on "Replace the studio desk lamp" | Two `moveItem` calls: Next→Active at the top, then back to Next after `it-news`. The undo toast was dismissed by Ctrl+Z. |
| 4 | `M` on a card | The menu lists seven statuses (current disabled), up/down/top/bottom and Open card. |
| 5 | Notes conflict ("Edit elsewhere", then type) | 409 `revision_conflict`, then the banner. **Keep mine** saved at revision 9. |
| 6 | Capture "Return library books tomorrow" | The suggestion offered "Target · Wed Oct 21". The title was unchanged, and no date was added without the button. |
| 7 | Weekly plan (proposed) drag | Only placement changed. Status, horizon, dates and revision were unchanged. |
| 8 | By date board: pointer drag, then Alt+→, then `M` | The drag started nothing and Alt+→ did nothing. No adapter call was logged. The menu showed statuses and Open card only. |
| 9 | Offline (`state=offline`) capture | A device draft was created and nothing was sent. Banner, footer and **Send drafts** were shown. |
| 10 | Narrow 420×860: status tabs, tab drop on "Considering", offline banner | All worked |
| 11 | Narrow 420×860: By date and Weekly plan | Groups stack vertically and all cards are reachable by scrolling, after fix F-2 below. |
| 12 | `executionCalls()` after every check above | `0` |
| 13 | `node --check` on the extracted inline script | Passed |
| 14 | Scan of the published files for private paths, addresses, names or credentials | No matches. The only hit was the word "tokens" in CSS comments. |

## Screenshots

All screenshots use fictional data.

| File | Shows |
| --- | --- |
| [01-board-status-light](mockups/evidence/01-board-status-light.png) | Status board, Inbox dock, card anatomy, project-scope note |
| [02-capture-light](mockups/evidence/02-capture-light.png) | Quick capture with the date suggestion, with instrumentation open |
| [03-board-by-date-light](mockups/evidence/03-board-by-date-light.png) | By date read-only groups and their rules |
| [04-weekly-plan-proposed-light](mockups/evidence/04-weekly-plan-proposed-light.png) | Proposed Weekly plan with its banner |
| [05-detail-links-dark](mockups/evidence/05-detail-links-dark.png) | Detail panel: links, Design annotation, Jones request and unavailable reference (dark) |
| [06-move-menu-and-log-light](mockups/evidence/06-move-menu-and-log-light.png) | Move menu, plus the adapter log of the move and its undo |
| [07-glance-dark](mockups/evidence/07-glance-dark.png) | Glance (dark) |
| [08-list-light](mockups/evidence/08-list-light.png) | List with inline status and horizon |
| [09-calendar-light](mockups/evidence/09-calendar-light.png) | Calendar with week and period bands, Unscheduled, Outside this month |
| [10-timeline-dark](mockups/evidence/10-timeline-dark.png) | Timeline across eight quarters (dark) |
| [11-review-light](mockups/evidence/11-review-light.png) | Review prompts |
| [12-narrow-offline-dark](mockups/evidence/12-narrow-offline-dark.png) | Narrow status board while offline (dark) |
| [13-narrow-weekly-plan-dark](mockups/evidence/13-narrow-weekly-plan-dark.png) | Narrow stacked Weekly plan (dark) |

## Critique and refinement

The `ui-design-craft` method was applied, using its rubric for hierarchy,
honesty of state, accessibility, density and platform fit. The skill's iPhone
`ui-handoff/1` package does not fit a desktop Electron module, so only the
method was used. **The rubric's fresh-context critic was not run**, because this
lane may not launch descendants. Every critique below is self-critique.

Earlier rounds fixed these issues:

- the detail title collapsing;
- an appearance-menu handler that swallowed later clicks;
- uneven calendar columns;
- overlapping timeline labels;
- Glance metadata squeezing titles;
- stretched Review panels;
- a noisy keyboard hint, now a `?` shortcuts dialog;
- the instrumentation panel starting open.

The final round on 2026-10-20 found and fixed these:

| ID | Finding | Fix |
| --- | --- | --- |
| F-1 | After Ctrl+Z, the move's toast stayed on screen. Its Undo button would have run the same inverse a second time. | An undo entry now runs at most once, and Ctrl+Z dismisses its toast (re-checked in check 3). |
| F-2 | At narrow widths the Weekly plan and By date boards showed no cards, because the narrow rule hid every non-current column. | Non-status boards stack their groups vertically (check 11). |
| F-3 | The board switcher's labels wrapped onto two lines at narrow widths. | Labels no longer wrap, and the switcher scrolls horizontally if needed. |
| F-4 | Notes autosaved after 900 ms; the Planner uses 1,200 ms. | Now 1,200 ms. |
| F-5 | The fictional preferences said the week starts on Sunday, while the calendar used Monday. | The preferences text now says Monday. The real question is Q-3. |
| F-6 | T1's RV-5 date-derived Lists were not represented. | Added the read-only **By date** board. |

## Known gaps in the mockup

- Glance omits the Planner's "Worth a look" panel.
- The date editor is display-only. Adding or changing dates is not mocked
  beyond capture.
- T1's per-device board presets (saved filters) are not mocked.
- Empty, loading and error states are not mocked as full views. The builder
  uses `@hq/ui` StateView.
- The fixture has no replay or `request_id_reused` behavior.
- No screen reader was used. Accessible names, roles and live-region
  announcements were inspected through the accessibility tree only.

## Incidental effect, recorded

At the start of rendering, the preview tab briefly loaded the default port
for this purpose. An **unrelated local service** was already listening there,
and it answered one `GET` for the mockup path with `401`. Nothing was sent
beyond that single page request, and nothing else was done there. The mockup
was then served from a different, free loopback port for every check above.
