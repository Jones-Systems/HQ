# Design Sources handoff

The six Sources views share this directory: References, Components, Flows, Taste, Imports and Discovery.
Motion and feedback come from `@hq/ui`, as described in
[HQ motion and feedback](../../../../../docs/design/hq-visual-system/motion-and-feedback.md):
`useToast`, `InlineNotice`, `StatusIndicator`, `Presence`, `useListMotion`, `Skeleton`, `useReducedMotion`,
`animateElement` and the `hq-enter-*`, `hq-stagger`, `hq-lift`, `hq-press` and `hq-flash` classes.
The shell mounts the single toast viewport.

This directory adds only the cross-section handoff to Taste:

| Export | Use |
| --- | --- |
| `tasteQueue` (`handoff.ts`) | Holds the items waiting for a Taste rating for the lifetime of the composition. It records nothing durable. |
| `sendToTaste(subject, navigate, toast)` | Queues a reference, component, flow screen or discovered project. Confirms with one updating toast that offers **Open Taste**. |
| `useHandoffQueue()` | The current queue, for Taste's **Waiting to rate** deck and for "queued" markers on cards. |
| `TASTE_LOCATION` | Taste's mount location, read from its descriptor. |

Sections stay independent: a section never imports this directory. Its composed view in `../views/` passes
callbacks such as `onSendToTaste`, or a section-owned context value, down to the section.

Rules shared by the Sources views:

- Container-responsive layout: the 572px content column of the default window is the primary target.
- Never fade, filter or recolour preserved content (captures, previews, `data-hq-content`). Animate the frame around it.
- Never transform a host element that a native runner overlays (the component stage). A transform moves the box without a resize event, so the overlay would drift.
- Keep the screen when something fails after content has loaded: show an inline notice or status there and toast one-off events.
