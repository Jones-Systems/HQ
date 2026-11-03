# Social calendar and representative empty state

Product entries: Social → Calendar and Social → Library. Calendar owns its
in-session grid and Agenda display; no new persisted key or service contract is
introduced. Separate Agenda/Month→Week→Day controls mirror Work, preserving the
grid and date on the return from Agenda. Existing save, unknown-state and
planning guards remain unchanged.

Use the [Work evidence build recipe](work.md) at port 4184 with `/?social` for a
fictional calendar, `/?social&empty` for empty Library, and `&theme=dark` for dark.
This mounts the real SocialContent with an in-memory fixture and no live service.
Reload resets fixture state. It does not qualify personal workspaces or sends.

The 2026-10-21 correction verifies separate buttons with an 8px gap, pressed
state, native keyboard cycling and Agenda return to Day. Rendered tests preserve
date drill-down and no-write assertions. The Library empty state is the checked
representative shared StateView consumer: glyph/text/action stay grouped with
no horizontal overflow at 760px. Design and Wiki source discovery found no
direct StateView consumers at this base; their custom states were not changed
or visually qualified by this shared-rule check. Other Social states remain
explicitly untested. Native, live-save and full accessibility certification are
not implied by these synthetic renderer checks.
