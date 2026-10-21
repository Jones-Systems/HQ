# Work presentation

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
