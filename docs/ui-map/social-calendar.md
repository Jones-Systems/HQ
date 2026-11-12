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

## Recovery source discovery (2026-11-12)

Runtime status: **unverified** for the recovered candidate. Earlier synthetic
observations above are historical and do not qualify these changed views.

The retained flow assessment and all four builder handoffs are linked from
[the Social lane handoff](../handoffs/hq-life-20261103/f3-social.md).
Known entries now include Overview, Sources import desk (`sources[/<id>]`),
workbench catalog/tool (`workbenches[/<tool>]`), Library/new composer
(`library/new`, including Start draft from a result), Calendar
(`calendar[/<YYYY-MM>]`) and Runs/receipt (`runs[/<id>]`). Sidebar navigation,
remembered destinations and reference navigation are separate unverified entries.

The source preserves the page frame and sync pill, session-only source imports,
inline validation, composer conflict/unknown-save states, calendar drag and
keyboard move, and unknown run matches that read without resubmitting. The
receipt has one Copy run ID control. Shared consumers are the Social PageHeader,
InlineNotice, StateView, Dialog, SaveIndicator, TimeGrid and shell toast viewport;
other domains consuming the shared kit have not been checked by this capsule.

The accepted layout remains the retained Social flow assessment: frame-owned
gutters, workbench rail becoming a strip, Library list/composer taking turns
below 780px, compact month chips and a narrow receipt peek. No redesign or new
capture baseline was produced. Light/dark/system, reduced motion, overflow,
keyboard, accessibility, native and actual export/gallery evidence all await
serial verification. Example seed wiring remains an explicit SHL handoff;
module source alone does not activate it in the desktop shell. Real posting
remains unavailable.
