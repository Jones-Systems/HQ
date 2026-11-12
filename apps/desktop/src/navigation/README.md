# Shell navigation (F7-B1)

Props-only components and hooks for cross-domain navigation. The shell owns every piece of state and mounts these; nothing here reads or writes shell storage.

```ts
import { CommandPalette, ReturnPill, useShellShortcuts, useDocumentTitle } from './navigation';
```

| Export | Props | Does |
| --- | --- | --- |
| `CommandPalette` | `domain`, `destinations`, `settingsOpen`, `projectId`, `appearance`, `references?`, `returnFrame?: { label, onBack }`, `onNavigate(domain, destination?)`, `onOpenSettings(target)`, `onAppearance(value)`, `mac?` | Ctrl/⌘K and the `hq-open-command-palette` window event. Commands, Settings, appearance, getting started (`hq-show-welcome` event), Back and cross-HQ search through `references`. Yields to a handled (`defaultPrevented`) event and to an open `[aria-modal="true"]` dialog. |
| `ReturnPill` | `label: string \| null`, `onBack`, `hidden?`, `mac?` | "← Back to <label>" in a zero-height anchor (mount it first in the workspace column). Alt+← (⌘[ on macOS) while shown. `label={null}` plays the exit motion; unmounting skips it. |
| `useShellShortcuts` | `{ switchDomain(domain), openSettings() }`, `{ mac? }` | Ctrl/⌘+1…4 and Ctrl/⌘+,. |
| `useDocumentTitle` | `{ domain, settingsOpen }` | `Settings — HQ` or `<Domain> — HQ`. |

Also exported: `OPEN_PALETTE_EVENT`, `SHOW_WELCOME_EVENT`, `describeLocation(domain, destination)`, `chordKeys`, `chordText`, `PALETTE_CHORD`, `SETTINGS_CHORD`, `currentPlatformIsMac` (for ⌘K / Ctrl K hints in a top-bar button), `resolveShellShortcut`.

## Mount

```tsx
const switchDomain = (domain: DomainId, destination?: string) => {
  settingsOpener.current = null; setSettingsOpen(false); references.cancelOpen(); setReturnFrame(null); setReferenceNotice(null);
  setState(previous => navigate(previous, domain, destination));
};
// rail button: onClick={() => switchDomain(domain)}

useShellShortcuts({ switchDomain, openSettings: () => openSettings(null) });
useDocumentTitle({ domain: state.domain, settingsOpen });

// first child of the workspace column
<ReturnPill label={returnFrame ? returnFrame.context.label : null} onBack={goBack} hidden={settingsOpen} />

// next to <ToastViewport />
<CommandPalette domain={state.domain} destinations={state.destinations} settingsOpen={settingsOpen} projectId={context.id}
  appearance={appearance} references={references} returnFrame={returnFrame ? { label: returnFrame.context.label, onBack: goBack } : null}
  onNavigate={switchDomain} onOpenSettings={target => openSettings(target)} onAppearance={setAppearance} />
```

`openSettings` is called after the palette has closed and restored focus, so the shell records the element the user came from as Settings' return target.

## Rules these follow

- Never bound: Alt+digits (Design), F6, Ctrl+\\, Ctrl+Shift+\\. Ctrl+K inside Design stays Design's.
- Every handler ignores `defaultPrevented`, an open `aria-modal` dialog and IME composition. Back also ignores editable fields.
- Destinations come from each module's route code (`destinations.ts`); `destinations.test.ts` parses every one with the module's own parser.
- Motion is `Presence` and the `@hq/ui` tokens. Reduced motion (`prefers-reduced-motion` or `data-hq-motion="reduce"`) unmounts instantly and moves nothing.

## Known limits

- **Updates** is not a palette command: `ServiceSettings` has no way to open that category from outside.
- Opening Settings when it is already open on a category the user picked by hand does not re-select a category: `ServiceSettings` only reacts to a changed `target`.
- Alt+← while a Work card at the leftmost board column has focus is not handled by Work (it returns without `preventDefault` when the move is impossible), so it goes Back.
- The preload reports `platform: 'desktop'`, never `'darwin'`, so macOS is detected from `navigator.userAgentData` / `navigator.platform`.
