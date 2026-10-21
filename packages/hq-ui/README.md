# @hq/ui

HQ's shared visual tokens and accessible UI primitives for the desktop shell, Design, Social, Work and Wiki. This is task `task.ui-kit.001` in `docs/engineering-specs/hq-social-work.md`; the interface is `iface.ui-kit.001`. It is a workspace package that resolves by name and is not published to a registry.

**Status:** wired into the modernization source candidate. Merge remains held for the integration owner; source checks and browser evidence do not establish installed application status. The current shell and calendar contract is [HQ UI modernization](../../docs/engineering-specs/hq-ui-modernization.md).

## Use it

```tsx
import { Button, PreservedContent, SaveIndicator, StatusChip } from '@hq/ui';

<StatusChip tone="warning" label="Stale" detail="last observed 3 days ago" />
<SaveIndicator state="unknown" onCheck={readBackTheSave} />
<PreservedContent kind="captured" recordedScheme="light">
  <img src={captureUrl} alt="Landing hero, captured 18 Oct" />
</PreservedContent>
```

Importing `@hq/ui` loads stylesheets as side effects:

- `src/tokens/hq-tokens.css`: `--hq-*` custom properties, `color-scheme` on `:root` and `[data-theme]`, and the preserved-content rules for `[data-hq-content]`.
- `src/components/hq-ui.css`: shared primitives plus a modern baseline for ordinary native controls. Preserved content and Design capture surfaces are excluded.
- `src/calendar/calendar.css`: shared timed-grid geometry and interaction states.

The scheme comes from `<html data-theme="light|dark">`, which T0's shell already writes. Without that attribute the OS preference applies.

## What it provides

| Export | What it is |
| --- | --- |
| Tokens | `src/tokens/hq-tokens.{css,json}` and `t0-bridge.css` match `docs/design/hq-visual-system/tokens/`. The current palette follows Design's cool neutrals and blue accent. Keep both copies synchronized when regenerating; `test/tokens.test.ts` checks equality and generated provenance. |
| `tokens.ts` | Token names only (`HQ_COLOR_ROLES`, `HQ_TOKEN_NAMES`, …): 45 colour roles, 4 artwork invariants, and type, space, radius, size, motion, layer, component and shadow roles. Values live only in the CSS. |
| `contrast.ts` | `contrastRows(tokens)` recomputes T2's 104 contrast pairs from the JSON source (WCAG 2.x, translucent roles composited), plus `contrastRatio`, `parseColor`, `composite` and `resolveRole`. |
| `Button`, `IconButton` | Primary, secondary, ghost and danger variants; `busy` shows a spinner and a verb in progress and ignores activation. `IconButton` requires a text `label`. Both default to `type="button"`. |
| `Splitter` | Pointer and keyboard resizing, zero-width collapse, restoration and cancellation; dimensions are applied through CSSOM. |
| `TimeGrid` | Shared Week/Day geometry and gestures: 15-minute snapping, overlapping blocks, move/resize cancellation and one callback on drop. Domain adapters own time zones, persistence and version guards. |
| `Menu` | Menu button with roving focus. Enter, Space or ArrowDown open it on the first item and ArrowUp on the last. Arrow keys wrap, Home and End jump, and typing jumps to a matching label. Escape closes and returns focus. Disabled items can be focused but not activated. |
| `Dialog` | Modal. Focus moves in on open, Tab is trapped, Escape closes, and focus returns to the opener. `role="alertdialog"` is available. |
| `Toast`, `ToastRegion` | A polite live region with an action, usually Undo, and an optional Dismiss (also Escape). Toasts never dismiss themselves. |
| `Tabs` | One tab stop. Arrow keys, Home and End move between tabs. Activation is automatic by default; with `manual`, Enter or Space selects. |
| `StatusChip` | A status word is always visible. Each tone has its own shape, so status never relies on colour alone, and an empty label throws. |
| `SaveIndicator` | Saved, saving, unsaved, failed with Retry, offline (kept on this device), and unknown with Check. Saving here is local persistence only and never starts execution. An unknown result is checked, never retried blindly. |
| `StateView` | Empty, loading (busy skeleton), error, offline, unavailable and unknown. |
| `PreservedContent`, `setContentScheme` | The RS-2 well, explained in the next section. |

## Preserved content

Captures, producer previews and exports go in a `PreservedContent` well, or any element marked `data-hq-content="captured" | "producer" | "export"`. The well sits on the constant artwork matte; `matte="checker"` gives a fixed transparency grid instead. The well pins `--hq-content-scheme` to the content's **recorded** scheme through CSSOM (`element.style.setProperty`). CSSOM is used because the app CSP (`style-src 'self'`) blocks inline style attributes.

An embedded iframe's `prefers-color-scheme`, and an SVG used as `<img>`, follow the owner element's used `color-scheme`. Without the pin, switching HQ to Dark would re-theme a light capture. Modules that render their own wells call `setContentScheme(element, 'light' | 'dark')`. No filter, blend mode or opacity is ever applied to preserved content, and the well has no `style` prop.

## Constraints for consumers

- **No inline styles.** The CSP blocks `style` attributes, so the primitives never set them. Size and state come from classes and explicit CSSOM custom properties.
- **Fonts.** The token stacks name IBM Plex first, but no font file ships with the kit, so text renders in the system fallback (interface text uses sans-serif; code can use monospace) unless Plex happens to be installed locally. Bundling Plex is held for an exact-file SIL OFL 1.1 provenance check under root ownership. Runtime Google Fonts are never used.
- **Domain roles.** Domain colours stay module-local under `--social-*` or `--work-*`. Each needs a light and a dark value and must be paired with a word and a shape.

## Checks

From the repository root:

```sh
npx vitest run packages/hq-ui      # token integrity, names, 104 contrast pairs, CSS invariants, keyboard paths
npx tsc -p packages/hq-ui/tsconfig.json --noEmit
```

The happy-dom tests prove roles, names and keyboard paths, but not pixels or computed colours. Those need a browser. The kit evidence page in `test/kit/` runs under the app's exact CSP; build and serve it with `npx vite build --config packages/hq-ui/test/kit/vite.config.ts`, then `npx vite preview --config packages/hq-ui/test/kit/vite.config.ts`. Its results are recorded, with preserved-content pixel and `color-scheme` checks, in [`docs/evidence/hq-social-work/ui/`](../../docs/evidence/hq-social-work/ui/README.md). That evidence lists the surfaces it does not cover: Electron, macOS, SF Pro fallback, screen readers, forced colours and 2× capture.
