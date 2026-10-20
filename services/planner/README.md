# Planning hub (website)

A private, single-owner planning hub for larger projects, ideas and personal
goals. You arrange items by hand: drag them between statuses, put them in
order, move dates around on a calendar, and shift their horizons on a timeline.
Items cannot start, queue or launch work anywhere else.

- **Frontend:** plain HTML, CSS and ES modules in `public/`. It has no build
  step and loads no external fonts, CDNs or analytics. Icons are inline SVG.
- **Backend:** Python 3 standard library only (`http.server` + `sqlite3`) in
  `planning/`.
- **Data:** one SQLite file at a path you choose. Safety backups are written
  into a folder next to it. Neither is ever served over HTTP.

The adopted candidate and its original file hashes are recorded in
[provenance.json](provenance.json). Persistent hosting is a separate, unapproved
[hosting proposal and device acceptance procedure](../../docs/operations/manual-planner-hosting.md).

## Run it locally

From the repository root:

```bash
cd apps/manual-planner
mkdir -p ~/planning-data            # any directory outside public/
python3 -m planning --data ~/planning-data/planning.sqlite3 --port 8765
# open http://127.0.0.1:8765/
```

| Option | Meaning |
| --- | --- |
| `--data PATH` | Required. The SQLite store. Its directory must already exist, and the path must be outside `public/`. The server warns if the path is inside this source tree. Backups go to `<name>-backups/` beside it. |
| `--host` | Loopback only: `127.0.0.1` (default), `::1` or `localhost`. Any other address is refused. |
| `--port` | Default `8765`. |
| `--allowed-host HOST[:PORT]` | Accept an extra `Host` header, for when a separately authorized private proxy sits in front of loopback. Repeat it for more than one host. |

Stop the server with Ctrl+C. A new store starts **empty**. Example items load
only when you ask for them (from the empty Glance screen or from
**Data & settings**). They are marked “Example” and can be removed in one
step.

## Tests

From this directory, after checking host capacity, run one process at a time:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests   # store, HTTP boundary, CLI guards
node --test --test-concurrency=1 'tests/*.test.mjs'                        # client date/order logic, render and app smoke
```

The Python tests put their scratch under `tests/.scratch/`, one
`TemporaryDirectory` per test. The context manager removes it whether a test
passes, fails or is cancelled. The empty parent folder is removed afterwards.
No test opens a listening socket or starts a browser. The HTTP handler runs in
the same process against a fake connection. The Node smoke tests render every
view and boot `app.js` against a small fake DOM (`tests/fake_dom.mjs`) with a
stubbed `fetch`. They catch wiring and runtime errors but **do not replace
real-browser checks** of layout, drag and touch.

## What you can do

| Area | Interactions |
| --- | --- |
| **Glance** (home) | A greeting with a one-line summary: active items, overdue items, upcoming dates and Inbox count. Status counts link to the Board. Panels show **Now** (Active or horizon Now, with the next step), the **next 21 days** (overdue deadlines first, then each day, then this month and quarter with no set day), **Inbox**, **Worth a look** and **Recently changed**. |
| **Board** | Seven manual statuses: Inbox, Considering, Next, Active, On hold, Done and Dropped. You can **drag a card across columns or reorder it within one**. While you drag, a placeholder opens where the card will land and a badge names the destination. Columns can be collapsed (Dropped starts collapsed) and still accept drops. Each card's **⋯ Move to…** menu covers every status plus up, down, top and bottom. From the keyboard: Alt+←/→ changes status, Alt+↑/↓ reorders, M opens the menu, and the arrow keys move focus. On a phone the board shows one column at a time with status tabs. Long-press a card to drag it, or drop it onto a tab. |
| **List** | A sortable table with inline **Status** and **Horizon** selects. On a phone the rows stack. |
| **Calendar** | A month grid or an agenda (agenda is the default on narrow screens). A **period band** holds month, quarter and year dates and never pins them to a day. Week dates appear in their week row. The **Unscheduled** tray lists items with no dates; drag one onto a day and choose Target, Deadline, Start or Event (Target is the default). You can **drag a dated chip to another day**: kind, time, zone and note are kept. Dragging a chip to the tray removes that date. Every chip has a menu: open, edit date and time, ±1 day, +1 week, remove. From the keyboard, Alt+arrows shift a focused chip by a day or a week, and PageUp/PageDown changes month. The **Outside this month** list shows earlier open dates and later ones. There are kind filters and a “show done & dropped” toggle. |
| **Timeline** | Horizon lanes (Now, Soon, Later, Someday, none) across the next eight quarters, with a line for today. Day dates are markers. Month, quarter and year dates are dashed bands covering exactly that period. A bar is drawn only from a start date to a **later** target or deadline that you set. Dates outside the range show as edge chips. **Drag a row to another lane** to change its horizon; its menu and Alt+↑/↓ do the same. On a phone it becomes a lane list with the dates written out. |
| **Review** | Gentle prompts. Inbox items get one-tap **Why** and **Horizon** buttons and a Move-to menu. Overdue deadlines offer Reschedule or Mark done. Passed targets offer a new target. Active items that have been quiet longer than an adjustable number of days offer “Still active” or Move. Items whose horizon and date disagree, and items with no “why”, are listed too. Nothing changes until you choose an action. |
| **Archive** | Archived items are hidden everywhere else and can be restored with their status and position kept. Archiving is not the same as Done. |
| **Item detail** | A side panel on desktop, full screen on a phone. You can edit the title, use status pills, and set Why, Horizon, Kind, Priority and Area (with suggestions). **Dates** are listed with their kind, precision, zone and relative time, plus the time in your display zone when the date's zone differs. The add/edit dialog covers kind, precision (day, week, month, quarter, year), an optional start and end time with an IANA zone, and a note. **Next steps** is a checklist you can reorder by drag or Alt+↑/↓. Notes save automatically. **References** are static links that open in a new tab. There is also history, Copy link and Archive. |
| **Capture** | Press N, the New button or the phone's + button. A title is the only required field. Shift+Enter saves and starts another. You can add an optional day-precision date while capturing. |
| **Data & settings** | Download a full JSON backup or a readable Markdown export. Import is checked completely first, then you choose **add new items only** or **replace everything**. Replacing needs a checkbox and writes a server-side safety backup before anything changes. You can restore from a listed backup, load or remove example items, and set preferences: time zone (for display and new timed dates), week start and the “quiet after N days” threshold. |

Every drag has a non-drag alternative and an **Undo** in the confirmation toast.
Ctrl/⌘+Z undoes the last change. Press `?` to see all shortcuts.

## Design choices

- **The visual system** uses warm paper surfaces, one ink-blue accent and
  restrained colour that always appears with a text label. Status uses a
  coloured dot plus its name. Why uses a coloured pill plus a word, and also
  sets a thin left accent on each card. Date kinds use an icon plus a word.
  Light and dark themes follow the system, and you can switch theme manually
  from the sidebar. Only open, overdue deadlines turn red. A passed target is
  neutral.
- **The Glance view comes first.** You asked for a hub you can read at a
  glance, so the landing page answers “what's active, what's coming, what
  needs sorting” without opening anything. The Board is one key away (2).
- **Dates never get invented.** Each date has a kind and a precision. Coarse
  dates stay periods: Q2 2027 is drawn as the quarter, never as April 1.
  When the editor switches a coarse date to day precision, the day is left
  blank until you pick one. Dragging rescheduling changes only the value, so
  a date's kind never silently becomes a deadline.
- **Times have zones.** A timed date stores its wall-clock time with an IANA
  zone, defaulting to America/New_York. The server derives the UTC instant
  and the abbreviation (EST/EDT) when it reads the data. It rejects times
  that don't exist because of a daylight-saving change (for example 02:30 on
  the spring-forward day). Date-only values never shift with the viewer's
  time zone.
- **One display zone.** “Today”, the Glance date and greeting, the sync
  clock, draft and backup times, and quiet-day counts all use the time zone
  in Data & settings (America/New_York unless you change it), not the
  browser's own zone. Clock times show their abbreviation, such as
  “6:36 PM EDT” or “12:05 PM EST”.
- **Order with filters on.** A drop is described as “after this visible
  card” or “before this visible card”. The server applies that anchor to the
  column's full stored order. A card dropped while filters hide some
  neighbours lands right beside the one you dropped it next to, and hidden
  cards keep their relative order.
- **Saves are honest.** A change counts as saved only after the server
  confirms it. Drags show the card in its new place marked “Saving…”, and it
  moves back if the server rejects the change. Every item has a revision. A
  stale edit gets a 409 response with the current item. Text fields keep
  what you typed and offer **Keep mine** or **Use theirs**, and they re-apply
  automatically when only a different field changed. Every change carries a
  request id. If the response is lost, the change is marked **unconfirmed**
  and re-sent with the same id when the server is reachable again. The
  server answers a retained repeated id from its record instead of applying
  the change twice. Records are bounded; see the Planner API replay rules
  before retrying an unknown outcome after retention may have expired.
- **Offline is shown, not hidden.** A banner says the server can't be
  reached, shows when data was last loaded, and pauses changes. While
  offline, new captures can be kept as **device drafts**, clearly labelled
  “not in the planning store”. You send them yourself once you're back
  online.
- **Shared state across devices.** All authority sits in the server's
  SQLite store, with WAL journalling and `synchronous=FULL`. The browser
  checks the state version every 20 seconds and when the tab regains focus,
  and pulls changes made on other devices. `localStorage` holds only UI
  preferences and device drafts.

## Planner API

`GET /api/version` and `GET /api/state` advertise `api: 2`, features
`items.batch_create` and `requests.replay`, and
`request_retention: {max: 2000, evicted_through_version: F}`. These are source
capabilities; an existing hosted service needs a separately authorized update.

`POST /api/items/batch` accepts only `{items: [fields…], dry_run?: boolean}`,
with 1–50 items using the same fields and date rules as single-item creation.
It validates every item before writing and returns indexed errors such as
`items[2].dates.value` with HTTP 400. A successful write returns HTTP 201 with
`{items, state_version}` in input order, places them in that order at each
status's top, records creation history, and increments the version once.
Any insertion failure rolls back the whole batch. `dry_run: true` returns
`{valid: true, count, dry_run: true, state_version}` without storing items,
history or a request record. The body limit remains 256 KiB; oversized bodies
return 413.

Mutation request IDs use `X-Request-Id` and match `[A-Za-z0-9-]{8,64}`.
While retained, the same ID and exact method/path/body bytes return the original
response with `X-Replayed: 1`; changed bytes return 422 `request_id_reused`.
Only the latest 2,000 request records are retained. **Never resend an unknown
write through the normal route after eviction is possible.** Read a state
version before the first send and retain it with the exact body bytes.

`POST /api/requests/replay` accepts only
`{mode: "lookup"|"resend", request_id, method, path, body_b64, sent_after_version?}`.
The original ID belongs in the envelope; an `X-Request-Id` header is rejected
with 400. `body_b64` encodes the exact original bytes. Replay targets are
`POST /api/items`, `POST /api/items/batch`, `PATCH /api/items/:id`,
`POST /api/items/:id/{move,archive,restore,reviewed}`, and `PUT /api/settings`.
Other targets return 400 `not_replayable`. Both original and envelope bodies
must be JSON objects. Inner bytes are capped at 256 KiB and the envelope at
352 KiB; either limit returns 413. Existing Host, content-type, custom-header,
Origin and Fetch Metadata guards apply.

A retained matching record returns HTTP 200
`{outcome: "replayed", status, response}` and `X-Replayed: 1`. A missing record
with an observed nonnegative `sent_after_version` at or above the eviction
floor is provably unapplied: `lookup` returns `{outcome: "not_applied"}`;
`resend` applies it and returns `{outcome: "applied_now", status, response}`.
A missing baseline or one below the floor returns 409 `replay_indeterminate`
without writing; read back and reconcile instead of issuing a new ID. Future,
negative or noninteger baselines return 400. Normal validation and conflict
errors pass through when applying. Lookup is only an observation; follow it
with this route's `resend`, never a normal-route send.

The floor check and resend hold the same reentrant lock as normal mutations.
This guarantee assumes one server process owns the store. A late original
request is deduplicated while its record remains retained. The floor only
increases; opening an older store at the retention cap initializes it to the
current version conservatively. Import and backup restore preserve request
records and the monotonically increasing state version.

## Security

- The server binds to loopback only. It answers only to known `Host`
  values, which guards against DNS rebinding.
- Changes need `Content-Type: application/json` and the custom
  `X-Planning-Request: 1` header, which forces a CORS preflight the server
  never grants. If an `Origin` header is present it must match the host, and
  `Sec-Fetch-Site` must be same-origin or absent. Bodies are capped at
  256 KiB (352 KiB for replay envelopes, 8 MiB for import), and chunked
  bodies are refused.
- Static files come only from `public/`, with an extension allow-list.
  Dotfiles, `..` paths and backslashes are rejected, and the store and
  backups are never served.
- Responses carry a strict CSP (`'self'` only, no inline script or style),
  plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
  and `Cache-Control: no-store` on API responses.
- Your text is only ever inserted as DOM text, never as HTML. Reference
  links must be `http(s)` and open with `noopener noreferrer`.
- The server validates every field, date, enum, size, id and import file.
  An import is validated completely before a single transaction, and an
  invalid file changes nothing.

## Limits and assumptions

- **No login.** The server is safe as a loopback-only service. Reaching it
  from a phone or another device needs a separately authorized private route,
  such as a private proxy in front of loopback plus `--allowed-host`. That is
  not set up here. The design assumes a single owner.
- **No permanent delete for your own items.** Archive hides an item and keeps
  it. The only removal is “remove example items”. Safety backups are not
  pruned automatically.
- **No recurring dates, reminders or notifications.** Nothing reschedules on
  its own.
- **Week dates** follow ISO weeks (Monday to Sunday). With a Sunday week
  start, a week date appears in the row that contains its Monday.
- **Calendar drag works on day-precision dates only.** Coarse dates are
  edited in the date dialog, so a quarter is never turned into a day by
  accident.
- **History** keeps the last 200 entries per item. Imports are limited to
  5,000 items or 8 MB. The design targets hundreds to a few thousand items,
  loaded in one request. Rendering at that size hasn't been measured.
- **Touch drag uses a long press (≈0.3 s).** It is implemented with Pointer
  Events and a non-passive `touchmove` guard. It has not yet been tested on
  real iOS or Android devices. The ⋯ menus and status tabs always work
  without dragging.
- The time-zone list comes from the browser (`Intl.supportedValuesOf`). The
  server accepts any zone in the host's tz database.
- Nothing here talks to Jones Code, workstreams, queues or any external
  service. References are plain links.
