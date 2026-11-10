# HQ motion and feedback

Artifact Type: design-brief
Artifact ID: brief.hq-motion-feedback
Purpose: One shared way for every HQ domain to animate, confirm actions and report problems, so the app feels alive without each module inventing its own.
Specification owner: HQ life-system lane F1 (shared shell and `@hq/ui`)
Consumers: Design, Social, Work, Wiki and Settings lanes; the desktop shell
Authority effect: none

Everything here ships from `@hq/ui`. Importing the package loads the tokens and the motion and feedback stylesheets, so there is nothing else to wire. The shell already mounts the single `<ToastViewport />`; modules only call `toast`, `useToast` or the inline components.

## Principles

1. **Motion explains change.** Animate what appeared, left, moved or became current. Don't decorate idle UI.
2. **Fast in, faster out.** Entrances are 160–240 ms with a decelerating or gentle spring curve. Exits are 90–160 ms and accelerate away. Nothing that blocks input runs longer than 240 ms.
3. **Feedback is immediate and in place.** Every press gets a visual response within one frame. A busy button shows its verb ("Saving"). The result appears where the user is looking.
4. **Keep the screen; report the problem.** A failed refresh or save does not replace the view. Keep what loaded, add an inline notice or status indicator there, and raise a toast for one-off events.
5. **Truthful outcomes.** Failure (`danger`) and *unknown result* (`unknown`) are different things. Offer **Retry** only when repeating is safe; for an unconfirmed outcome offer **Check**, never a blind retry. Neither tone auto-dismisses.
6. **Reduced motion is honoured everywhere.** Under `prefers-reduced-motion: reduce`, or when the shell sets `<html data-hq-motion="reduce">`, every duration is 0 ms, distances are 0 px and scales are 1. Content still appears and disappears, with no movement. Spinners slow down; skeleton sheen and shimmer stop.
7. **Keyboard and screen readers first.** Toasts are announced through live regions (failures assertively). F8 jumps to the newest toast and back; Escape dismisses the focused toast. Inline notices use `role="alert"` or `role="status"`. Field errors use `aria-describedby`.

Reference points: Linear (quick, quiet transitions and toast stack), Things 3 (gentle springs, confirmation in place), Raycast (instant press feedback, compact toasts), Arc (page transitions that keep context), Notion (inline, non-blocking errors).

## Tokens

Defined in [`tokens/hq-tokens.json`](tokens/hq-tokens.json) under `motion`, generated into `--hq-*` custom properties. Script code uses `MOTION_DURATIONS` and `MOTION_EASINGS`, which a test keeps equal to the JSON.

| Token | Value | Use |
| --- | --- | --- |
| `--hq-duration-instant` | 60ms | Press-down feedback |
| `--hq-duration-fast` | 90ms | Hover and colour changes, fast exits |
| `--hq-duration-base` | 160ms | Small enters, most exits, menus |
| `--hq-duration-slow` | 240ms | Panels, toasts, page enters, list moves |
| `--hq-duration-slower` | 360ms | Large layout changes (rarely) |
| `--hq-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Moves and state changes |
| `--hq-ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Things arriving (decelerate) |
| `--hq-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving (accelerate) |
| `--hq-ease-spring` | `linear(…)`, 3% overshoot | Pops: toasts, popovers, scale-ins |
| `--hq-motion-distance-sm/md/lg` | 4 / 8 / 16px | Travel for rise, drop and slide |
| `--hq-motion-scale-press` | 0.97 | Pressed controls |
| `--hq-motion-scale-enter` | 0.96 | Scale-in start |
| `--hq-motion-stagger` | 28ms | Delay between list items entering |

Fonts: `--hq-font-family-sans` now names concrete faces (`-apple-system`, Segoe UI, Roboto, Arial, Liberation Sans, Noto Sans) before `system-ui`/`sans-serif`. Some Linux fontconfig setups resolve both generics to Liberation Mono, which made every screen look monospace.

## Motion primitives

```tsx
import { Presence, usePresence, useListMotion, PAGE_TRANSITION_CLASS, navigateWithTransition, Skeleton, useReducedMotion } from '@hq/ui';
```

| API | What it does |
| --- | --- |
| `<Presence show motion="rise">…</Presence>` | Mounts with an enter animation and keeps children mounted until the exit animation ends. Motions: `fade`, `rise`, `drop`, `scale`, `slide-end`, `slide-start`, `collapse` (animates real height, so content below glides) and `toast`. `as="li"` and similar change the wrapper. `initial={false}` skips the first enter for restored views. |
| `usePresence(show, { motion })` | The same behaviour for your own element: `{ mounted, ref, props }`; spread `props` and pass `ref`. |
| `useListMotion(ids)` | FLIP reordering. Put the returned ref on the list and `data-hq-motion-key={id}` on each item. Items glide to new positions when `ids` changes (sort, filter, drag-drop, insert); new items fade and rise in. |
| `navigateWithTransition(() => setView(next), 'forward')` with `className={PAGE_TRANSITION_CLASS}` on the element that holds the view | Page or view switch through the View Transitions API: the old view fades out in 90 ms, the new one rises in over 240 ms (fades in when the direction is `'back'`) and the rest of the window cross-fades. The update still renders synchronously, so navigation never waits on data and Suspense fallbacks show at once; layout is final while the snapshots animate. Exactly one rendered element may carry the class. Reduced motion and engines without the API swap instantly. |
| `<Skeleton shape="text" lines={3} />`, `shape="block"`, `shape="circle"`, `width`, `height` | Loading placeholders with sheen. Mark the region `aria-busy="true"` and keep a short status ("Loading cards…"). Prefer skeletons shaped like the content over a spinner in the middle of the panel. |
| `useReducedMotion()`, `prefersReducedMotion()` | Live preference (OS or shell override) for script-driven animation. |
| `animateElement(el, keyframes, { duration, easing })` | Web Animations API with tokens. Returns `null` and does nothing under reduced motion. CSP-safe (it writes no `style` attribute). |

CSS utilities (class names):

| Class | Effect |
| --- | --- |
| `hq-enter-fade`, `hq-enter-rise`, `hq-enter-drop`, `hq-enter-scale`, `hq-enter-slide-end` | One-shot enter on mount. |
| `hq-stagger` (on a container) | Children rise in one after another. |
| `hq-press` | Press-down scale for custom controls. `@hq/ui` `Button`/`IconButton` already have it. |
| `hq-lift` | Cards rise 1px with the raised shadow on hover. |
| `hq-flash` | One-shot accent wash that shows where a change landed (a moved card, a saved row). It is colour-only, so it also plays under reduced motion. |
| `hq-shimmer-text` | Shimmering in-progress label ("Syncing…"); static under reduced motion. |

Do not animate preserved content (`[data-hq-content]` wells) with filters or lasting opacity. Transient enter/exit on a wrapper is fine.

## Feedback primitives

```tsx
import { toast, useToast, InlineNotice, StatusIndicator, FieldError, fieldErrorProps, ErrorBoundary, useAsyncAction } from '@hq/ui';
```

### Toasts: one-off events

```ts
toast.success('Card moved to Active');
toast.show({
  title: 'Moved “Tasting-night signage” to Active',
  meta: 'Planning change only · no run started',
  action: { label: 'Undo', onAction: undoMove },
});
toast.error("Couldn't save the board", { description: 'Your move is kept on this device.', action: { label: 'Retry', onAction: save } });
toast.unknown('Save result unknown', { description: 'The Planner did not answer.', action: { label: 'Check', onAction: reconcile } });
const id = toast.loading('Exporting…');  toast.update(id, { tone: 'success', title: 'Exported' });
await toast.promise(exportBoard(), { loading: 'Exporting…', success: 'Exported', error: (e) => `Export failed: ${String(e)}` });
toast.dismiss(id);
```

| Tone | Default life | Announced | Use |
| --- | --- | --- | --- |
| `neutral`, `info` | 5 s | politely | Confirmations with no status meaning |
| `success` | 4 s | politely | The action completed |
| `warning` | 8 s | politely | Completed with a caveat |
| `danger` (`toast.error`) | until dismissed | assertively | The action failed; say what was kept |
| `unknown` | until dismissed | assertively | The outcome is not confirmed; offer Check |
| `loading` | until updated | politely | In progress; turn it into the result |

A toast with an action stays at least 8 s. Timers pause while the pointer is over the stack, while focus is inside it, and while the window is hidden. Showing the same `id` again updates that toast in place; identical toasts fold into one with a ×N count. Three toasts show at once; older ones fold behind “N more notifications”. Inside React prefer `const toast = useToast()`, which respects a `ToastStoreProvider` in tests and harnesses; outside React, import `toast` directly.

Write titles as one short sentence in plain words. Put provenance in `meta` (mono). Don't toast what the UI already shows: a card that visibly moved needs at most an Undo toast, not "Success".

### Inline notices: problems on the current screen

```tsx
<InlineNotice tone="danger" title="Couldn't refresh the board" actions={[{ label: 'Retry', onAction: reload, busy: reloading }]}>
  Showing what loaded at 14:02. Nothing was changed.
</InlineNotice>
<InlineNotice tone="warning" variant="bar" title="Stale" live="off">Last observed 16 Oct 09:40</InlineNotice>
```

Tones: `neutral`, `info`, `success`, `warning`, `danger`, `unknown`. `variant="bar"` is one compact line for the top of a list or panel. By default `danger` and `unknown` announce assertively (`role="alert"`) and the rest politely. Use `live="off"` for notices that are present when the view loads. `onDismiss` adds a dismiss button; pass `label` to name the notice region and `dismissLabel` to name that button when "Dismiss" alone is ambiguous (the shell's reference notice uses "Read-only reference" and "Dismiss reference"). Wrap one in `<Presence show={failed} motion="collapse">` so it slides open and closed instead of jumping.

### Status indicators: ongoing state

```tsx
<StatusIndicator tone="success" label="Synced" detail="2 min ago" />
<StatusIndicator tone="neutral" busy label="Syncing" />
<StatusIndicator tone="danger" label="Offline" detail="kept on this device" action={{ label: 'Reconnect', onAction: reconnect }} />
```

The indicator is a shape, a word, optional mono detail and one text action. Use it in toolbars, panel headers and rows. Set `live={false}` when many appear in a list.

### Field errors

```tsx
<input aria-label="Title" {...fieldErrorProps('title-error', error)} />
<FieldError id="title-error">{error}</FieldError>
```

### Async actions

```tsx
const save = useAsyncAction(saveCard, { error: "Couldn't save the card", retry: true });
<Button busy={save.pending} busyLabel="Saving" onClick={() => void save.run(draft)}>Save</Button>
```

It ignores a second activation while pending, raises one failure toast per action (updated in place on repeat failures) and clears that toast on the next success. Pass `error: false` when the screen shows the failure inline instead. Pass `retry: true` only when running the action again is safe.

### Error boundary

```tsx
<ErrorBoundary resetKeys={[destination]} title="The board stopped working">
  <Board />
</ErrorBoundary>
```

A render crash stays inside the wrapped region: navigation keeps working and the region shows an inline danger notice with **Try again**. The shell wraps each mounted domain.

## Replacing full-screen error states

`StateView` stays the right answer when there is *nothing* to show: a first load that failed, an empty list, an unavailable service with no snapshot. Once any content has loaded, a later failure must not replace it.

| Situation | Before | Now |
| --- | --- | --- |
| Refresh fails after a snapshot loaded | Whole panel becomes `StateView state="error"` | Keep the snapshot. Add `InlineNotice tone="danger" variant="bar"` with Retry above it, or a `StatusIndicator` in the header. |
| Save or move fails | Error screen or silent failure | Roll back optimistically applied UI, then `toast.error(…, { description: what was kept, action: Retry })`. |
| Outcome unknown (timeout, lost response) | Error screen | `toast.unknown(…, { action: Check })` plus a `StatusIndicator tone="unknown"` on the affected item until reconciled. |
| Service offline while browsing | Full-screen unavailable state | `StatusIndicator tone="danger" label="Offline" detail="showing saved copy"` in the header; keep cached content readable. |
| First load fails, nothing cached | `StateView` | Unchanged: `StateView state="unavailable"` with Try again. |
| Loading | Centred spinner | `Skeleton` shaped like the content, `aria-busy` on the region. |

## Checks

`npx vitest run packages/hq-ui` covers the token sync, the reduced-motion overrides, the stylesheet invariants (`.hq-*` scope, tokens only, no lasting opacity or filters, token-timed animation) and the toast, notice, field-error, status, boundary, presence and async-action behaviour in happy-dom. Pixels, real animation timing and View Transitions need a browser; record those checks separately.
