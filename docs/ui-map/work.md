# Work presentation

Shared recovery correction (source only): the board drag ghost now uses the
UI kit's body-mounted `Portal`; its package boundary remains unchanged. Exiting
shared toasts retain their visual animation but hide from accessibility, disable
actions and reject stale action handlers. F8 targets the newest active toast.
Focused regression source covers portal ownership/cleanup and stale Undo/exit
focus. Current-head execution, native drag, focus and visual evidence are unverified.

## Recovery source discovery (2026-11-12, unverified)

The recovery frame mounts compact capture, always-visible labelled filters,
one shared toast bridge, navigation counts/number shortcuts and a shared-dialog
detail sheet below 720px of work-area width. The frame retains 12px content
gutters; the board owns its horizontal scroller. Reduced motion uses the shared
tokens and OS/shell preference. These source changes invalidate historical
appearance evidence for the changed surfaces; the observations below are historical.

Known entries: Work navigation and remembered destinations; `board`,
`board/by-date`, `glance`, `list`, `item/<id>`; N opens capture and 1–7 navigate
outside typing/modal/scoped key owners. Board cards open detail by Enter or
title activation, move with Alt+arrows, drag or their move menu, and offer Done.
Alt+Left at Inbox reserves the chord without a write or shell reference return.
List titles open the same detail, and its status select uses the move path.
Glance Now offers Done with Undo. Confirmed Inbox captures land at the visible
Inbox list or Status board navigation item; unknown saves offer Check.

WRK-V2 implements `board/week` in the existing nav order: backlog, seven
Planner-start day columns and an ISO-week lane. Plan for menus, P and Alt+arrows
share one date patch path with pointer drag. Week conversion explicitly clears
clock fields; backlog removes only the represented date. Done uses move/Undo.
The board scrolls horizontally at intermediate widths and stacks below 760px.
Calendar exposes Month/Week/Day/Agenda, period controls, grouped unscheduled work,
date picking and timed/all-day drops. Timeline exposes eight-quarter navigation,
horizon drop/menu/Alt+arrow controls and same-lane refusal.
Review exposes Inbox triage with scoped Why, horizon and move keys, session
progress, read-only last-seven-day counts and retained row exits. Inputs yield
to typing; triage consumes handled keys before global navigation. Archive Restore
uses the same retained exits. Editable Weekly plan remains Proposed.
The optional queue projection labels queued, sending, conflict, rejected and held
states and blocks repeated edits. Unknown results remain Unconfirmed with the
existing Check path; no replay action is added. WRK-Q is read-only design/API input
here and must be composed by the parent; queue runtime evidence remains absent.

New shared consumers: retained rows use `@hq/ui` Presence and list motion in
Review and Archive. Plan week reuses Menu, DoneButton, date chips and PageHeader.
No shared primitive or route mapping changes. Source-authored regression coverage
names ISO-week mapping, date preservation, keyboard plan/Undo and triage key
ownership. These tests are unrun. All new entries and layout states are unverified.

Shared consumers: `@hq/ui` Dialog (capture and narrow detail), Menu (detail and
capture chip pickers), toast viewport (shell or standalone fallback), list motion
and navigation transitions. No shared primitive is edited. All entry points,
responsive states, focus/keyboard behavior, enlarged text, native persistence,
layout fidelity and gallery/export evidence for this candidate are unverified.
Later serial qualification must exercise wide/narrow light/dark/system states,
reduced motion, capture recovery, unknown Check without duplicate intent, one
Undo per action, board drag/cancel/edge chords and detail focus restoration.

Product entry: Work domain → Home/status board or Calendar. WorkDomain owns the
outer content gutter and scroll region; StatusBoard owns the horizontal columns
scroller; CalendarView owns the view controls. Existing Work stores, navigation,
DnD and remembered scroll offsets retain their own contracts.

From the repository root, build the existing synthetic evidence page:

```sh
node_modules/.bin/vite build --config modules/work/views/evidence/vite.config.ts
node_modules/.bin/vite preview --config modules/work/views/evidence/vite.config.ts
```

Port 4184 uses a static build under the app CSP, with in-memory fictional stores
and no network. `/?domain` opens the full domain; `/?domain&empty` opens the empty
board; `/?view=calendar` opens the planning view. Add `&theme=dark` for dark.
`/?states` retains the existing state matrix. Reload resets fixture mutations;
use an isolated context for remembered UI preferences. Stop only the owned server.

Verified for the 2026-10-21 correction: 12px top/side/bottom content gutters at
760/1280/1440px; toolbar visible and hidden; natural lane heights with the blank
25/50/90% board positions hitting the same full-height scroller; actual horizontal
wheel movement and keyboard horizontal navigation. At 200% text the checked
Work scroll endpoint remains reachable with its bottom gutter. Empty-board
glyph, title, description and action share the heading's inline edge. Calendar
Month→Week→Day, Enter/Space and Agenda roundtrip keep the chosen date/grid and
make no planning writes; existing tests cover persisted mode and drill-down.

Physical touchpad/shift-wheel hardware, all drag/drop combinations, full native
Electron and real-store journeys are unverified. Existing unrelated compact
controls may still need a broader text-enlargement pass; this correction only
adjusts the changed calendar controls and Interactive actions. Private logs and
capture manifests bind the observations to the candidate; see the Work Note.

The same-source enlarged-calendar follow-up adds an explicit separation probe:
at 760/1280px, both normal and 200% text, all Agenda element and text-range
rectangles remain outside the Unscheduled tray. Main/tray separation is 10px;
long titles, dates and times wrap inside the constrained left grid. The earlier
zero-document-overflow observation alone missed this overlap and must not be
used as proof of column separation. Fresh normal/enlarged captures and exact
source/build correspondence supersede the earlier calendar stress capture.
