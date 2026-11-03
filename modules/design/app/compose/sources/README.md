# Design Sources: motion, feedback and handoff

Shared by the six Sources views (References, Components, Flows, Taste, Imports, Discovery) in the composed
Design module. Sections stay independent: a section never imports this directory. Its composed view in
`../views/` wraps the section in `SourcesSurface` and passes callbacks such as `onNotify` or
`onSendToTaste` down as props.

| Export | Use |
| --- | --- |
| `SourcesSurface` | Wrap a composed Sources view. Adds the motion scope and the one toast host. |
| `sourcesFeedback.push({ tone, message, meta?, action?, id?, autoDismissMs? })` | Report an outcome without replacing the screen. Info and success expire after 5 s; warning and danger stay until dismissed. Reuse an `id` to update a progress toast in place. |
| `InlineStatus` | `pending`, `saved`, `failed` or `unknown` beside the control it describes, as a dot plus a word. |
| `sendToTaste(subject, navigate)` / `tasteQueue` / `useHandoffQueue()` | Queue a reference, component, flow screen or discovered project for rating. The toast offers **Open Taste**. Nothing is rated until the owner rates it. |
| `usePrefersReducedMotion()` | For motion driven from script. CSS motion uses the classes below. |
| `staggerStyle(i)` | Sets `--hqs-i` through CSSOM for `.hqs-stagger` children. |

CSS classes in `sources.css` (all built on `--hq-duration-*` and `--hq-ease-*`):

- `.hqs-enter`, `.hqs-pop` and `.hqs-fade` are entrances. Children of `.hqs-stagger` enter in sequence.
- `.hqs-lift` gives cards a hover lift. `.hqs-press` gives press feedback.
- `.hqs-progress` is a progress bar. Set `--hqs-progress` (0–1) for a determinate bar, or `data-indeterminate="true"` for a sweep.

Section CSS uses the same tokens directly, so section harnesses keep working without this file.

Rules:

- Under `prefers-reduced-motion: reduce`, the tokens resolve to `0ms` and every class here turns its animation off. Script-driven motion must check `usePrefersReducedMotion()`.
- The shell CSP blocks style attributes. Set dynamic values through React `style` objects, which use CSSOM, never through markup.
- Never animate, filter or fade preserved content (`data-hq-content`, captures, previews). Animate the frame around it.
- Do not apply transforms to a host element that a native runner overlays: a transform moves the box without a resize event, so the overlay drifts.
- Toasts announce outcomes. Errors that block an action also stay inline next to that action until resolved.

When the shared shell primitives from lane F1 (`docs/design/hq-visual-system/motion-and-feedback.md`) land,
`SourcesToasts` and these classes switch to them in this directory only; callers keep the same API.
