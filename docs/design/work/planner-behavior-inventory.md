# Manual Planner behavior inventory

Artifact Type: `design-evidence`

Artifact ID: `evidence.hq-work-planner-inventory`

Purpose: Record the current Manual Planner behavior that HQ Work must preserve, read directly from source.

Governing artifact: `brief.hq-work-design`

Decision owner: M Jones

Consumers: HQ Work design, the Social/Work implementation planner, Work builders

Authority effect: none

## Source identity

All citations are `path:line` in `Jones-Systems/Codex-V3` at
`4beb491c44551b6e4207adcc7459c4b11407bcbc`, under `apps/manual-planner/`.
Only the source was read. No live Planner instance, store, backup or device
draft was opened, and no planning data was read. The source README describes
itself as a single-owner planning hub. Its runtime is Python standard-library
`http.server` plus `sqlite3`, and its frontend uses plain ES modules with no
build step.

## Record model

| Field | Values and rules | Source |
| --- | --- | --- |
| `status` | `inbox`, `considering`, `next`, `active`, `on_hold`, `done`, `dropped`. Required; default `inbox`. | `planning/validation.py:15` |
| `horizon` | `now`, `soon`, `later`, `someday`, or none. A separate axis from status and dates. | `planning/validation.py:18` |
| `motivation` (shown as **Why**) | `need`, `want`, `exploring`, or none. | `planning/validation.py:17` |
| `kind` | `project`, `idea`, `goal`, `chore`. Default `idea`. | `planning/validation.py:16` |
| `priority` | `high`, `normal`, `low`, or none. | `planning/validation.py:19` |
| `area` | Free text, at most 40 characters. A single label, not a list of tags. | `planning/validation.py:24` |
| `notes` | Multiline text, at most 20,000 characters. | `planning/validation.py:25` |
| `next_steps` | Checklist of `{id, text, done}`, at most 100 steps of 300 characters each. | `planning/validation.py:114` |
| `references` | `{id, kind, label, url}`. Kinds: `url`, `doc`, `repo`, `pr`, `project`, `workstream`, `other`. A URL must be `http(s)`; label-only entries are allowed. At most 30. | `planning/validation.py:20`, `:140`, `:150` |
| `dates` | `{id, kind, precision, value, time?, end_time?, tz?, note?}`. Kinds: `target`, `deadline`, `start`, `event`. Precisions: `day`, `week`, `month`, `quarter`, `year`. Only day precision may carry a time, and a timed date needs an IANA zone. Times that fall in a daylight-saving gap are rejected. At most 20. | `planning/dates.py:18-19`, `:132` |
| Store-owned | `id`, `revision`, `position`, `is_example`, `created_at`, `updated_at`, `archived_at`, `reviewed_at`. | `planning/store.py:77-97` |
| Settings | `default_tz` (default `America/New_York`), `week_start` (`sun`/`mon`), `stale_days` (1–365, default 21). | `planning/validation.py:37` |

There is no project, board, list, label-set, owner or tenant field. Store
schema version 1 is enforced on open, and any other version is refused
(`planning/store.py:41`, `:136`).

## Service contract

| Behavior | Detail | Source |
| --- | --- | --- |
| Read | `GET /api/state` returns every item, the settings, `state_version` and `server_time`. `GET /api/version` is the cheap poll. | `planning/server.py:182-185` |
| Create | `POST /api/items` with `{fields}`. The new item goes to the **top** of its status. | `planning/store.py:176-195` |
| Patch | `PATCH /api/items/{id}` with `{revision, patch}`. A status change through a patch also moves the item to the **top** of the new column. | `planning/store.py:197-231`, `:218` |
| Move | `POST /api/items/{id}/move` with `{revision, status, after_id \| before_id \| place}`. The anchor is resolved against the full stored column, which is then renumbered in steps of 1024. A missing anchor returns 409 `order_conflict`. | `planning/store.py:233-278`, `:256` |
| Archive and restore | `POST …/archive` and `POST …/restore`. Archive is distinct from Done, and status and position are kept. | `planning/store.py:280-292` |
| Reviewed | `POST …/reviewed` stamps `reviewed_at`. | `planning/store.py:294-303` |
| Revision guard | Every item mutation names its base revision. A stale revision returns 409 `revision_conflict` with the current item. | `planning/store.py:507-517` |
| Idempotency | `X-Request-Id`. Replaying the same id with the same body returns the recorded response with `X-Replayed: 1`. The same id with a different body returns 422 `request_id_reused`. The last 2,000 ids are remembered. | `planning/store.py:496-505`, `:46`; `planning/server.py:139-148` |
| Durability | Each mutation runs in one `BEGIN IMMEDIATE` transaction, with WAL and `synchronous=FULL`. `state_version` increments on every mutation. | `planning/store.py:471-494` |
| History | Actions: created, updated, moved, reordered, archived, restored, reviewed, imported. The last 200 entries are kept per item. | `planning/store.py:45`, `:48`, `:529-535` |
| Export | `GET /api/export` returns `jones-planning-export` v1 with items, history and settings. `GET /api/export.md` returns readable Markdown. | `planning/store.py:42`, `:352-384` |
| Import | Preview validates the whole file first. Then either `merge` adds new ids only, or `replace` requires `confirm: "replace"` and writes a fsynced server-side backup before the transaction. An invalid file changes nothing. Limits are 5,000 items and 8 MB. | `planning/store.py:386-445`, `:665-692` |
| Restore backup | Restoring a listed backup goes through the same replace path. | `planning/store.py:456-467` |
| Examples | The only hard delete removes example items (`is_example=1`). User items are never permanently deleted. | `planning/store.py:340-348` |
| Request guard | Mutations need `Content-Type: application/json` and `X-Planning-Request: 1`. A present `Origin` must equal `Host`, `Sec-Fetch-Site` must be same-origin or absent, and `Host` must be loopback or explicitly allowed. | `planning/server.py:87`, `:203-220` |

## Client behavior

| Behavior | Detail | Source |
| --- | --- | --- |
| Views | Glance (1), Board (2), List (3), Calendar (4), Timeline (5), Review (6), Archive (7). Glance is the landing view. | `public/js/app.js:28-36` |
| Board movement | Drag across and within columns uses Pointer Events. The mouse threshold is 5 px, and touch needs a 320 ms hold. A placeholder shows where the card will land, and a badge names the destination. Collapsed columns still accept drops, and Dropped starts collapsed. Escape cancels a drag. | `public/js/drag.js:10-12`; `public/js/views/board.js:12`, `:204-283` |
| Drag alternatives | Each card's Move-to menu lists every status plus up, down, top and bottom. On the keyboard, Alt+←/→ changes status (to the top of the target), Alt+↑/↓ reorders, M opens the menu, and the arrow keys move focus. On a phone, dropping on a status tab moves the card to the top of that status. | `public/js/views/board.js:140-175`, `:52`, `:271` |
| Ordering under filters | A drop is expressed as "after or before a visible neighbour". The server applies it to the full order, so hidden cards keep their relative order. | `public/js/ordering.js:19-35`, `:63` |
| Honest saving | A drag shows a pending projection marked "Saving…". It rolls back on rejection, and settles with a refresh because neighbours are renumbered. | `public/js/state.js:163-196` |
| Lost response | A network failure marks the change unconfirmed (held in memory) and sets the connection offline. On reconnect the change is re-sent with the same request id. | `public/js/state.js:129-160`, `:214-240` |
| Sync | Polls `/api/version` every 20 s and on tab focus. It pulls the full state when another device changed something. | `public/js/state.js:11`, `:242-268` |
| Undo | An in-memory stack of 40 entries per tab. The toast's Undo and Ctrl/⌘+Z both use it, and the shortcut is ignored while typing. A move restores its neighbour anchor, falling back to the top if the order changed. A field patch sends the inverse values at the latest revision. | `public/js/actions.js:12-41`, `:87-114`, `:116-150`; `public/js/app.js:758-765` |
| Text conflicts | On 409, if the field is unchanged on the server, the client re-applies its value automatically. Otherwise the user's text is kept and the panel offers **Keep mine** or **Use theirs**. | `public/js/detail.js:117-183` |
| Notes | Autosave after a short debounce, and flush on blur. | `public/js/detail.js:316-325` |
| Capture | N opens capture, and only a title is required. Shift+Enter saves and starts another. An optional day date can be added. | `public/js/app.js:491` |
| Offline drafts | Captures made while the service is unreachable are kept in `localStorage` as device drafts, labelled as not in the store, and sent manually. | `public/js/state.js:12`, `:271-323` |
| Theme | A local `planning.theme` setting: auto, light or dark. | `public/js/app.js:39`, `:732-755` |
| Local UI state | Collapsed columns, phone column and calendar mode are stored in `localStorage`. These are preferences only. | `public/js/views/board.js:12-34`; `public/js/views/calendar.js:28` |
| References | Static links that open in a new tab with `noopener noreferrer`. They cannot start work. | `public/js/detail.js:525-560` |

## Observations relevant to HQ

These are behaviors seen in the source. They are not defects being reported
against the Planner.

1. A patch-based undo sends the inverse value at the latest revision. If
   another device changed the same field between the action and the undo,
   the undo overwrites that change without a conflict
   (`public/js/actions.js:90`, `:99-108`).
2. A status change made through a **patch**, as the detail status pills and the
   List view's inline select do, puts the card at the top of the new column.
   Undoing it patches the old status back, which also lands at the top, not at
   the card's original position (`planning/store.py:218-220`).
3. Unconfirmed changes and the undo stack live only in memory. Closing the
   tab loses the client's knowledge of an uncertain send. The server still
   holds the truth, and its replay record survives for 2,000 requests.
4. New items always go to the top of their status. An "Add a card" composer
   at the bottom of a list, as in Trello, would need either a create-then-move
   pair or a new `place` option on create.
5. The theme is per origin in `localStorage`. HQ owns appearance, so the
   Planner's own theme toggle does not carry over.
6. The request guard admits same-origin browser pages only. A renderer at
   another origin, such as an Electron `app://` or `file://` page, is refused
   for mutations. Reads would also be blocked under a strict renderer CSP.
