# Settings › Appearance and dark palettes

Purpose: choose Light, Dark or System, and choose or edit the dark palette HQ uses whenever its resolved theme is dark. Design: [HQ Settings design](../design/settings/hq-settings-design-20261103.md) (Appearance section); captures: [after-20261103 evidence](../design/settings/evidence/after-20261103/README.md).

## Entry points

- Rail → Settings → Appearance (second category of the **App** group, after the **Data sources** group). Selecting a category scrolls its content to the top and moves focus to the category heading.
- `hq-open-settings` window event with `detail.source = 'appearance'` (opens directly on Appearance).
- The rail appearance button cycles Light → Dark → System; it does not open Settings.

## States and subviews

- Color theme: three 132×84 tiles (Light, Dark, System) in a `radiogroup` named Color theme, stored in `hq.appearance.v1`. The selected tile is the only tab stop; Arrow keys move and select (wrapping), Space/Enter or a click selects. Each tile is drawn with real token colours inside its own `color-scheme` scope: Light always shows the standard light colours (read from the generated token strings, so a dark palette's inline overrides never leak into it), Dark shows the selected dark palette, System splits the two. System states `Following your device: Dark` or `Light`.
- Switching from Settings runs inside `document.startViewTransition` (a short crossfade) when the browser has it and motion is allowed; with `prefers-reduced-motion` or `<html data-hq-motion="reduce">`, or without the API, the change is instant. The rail button does not use it.
- Dark palette: radio group of Slate, Warm Graphite (initial), Harbor and Sage cards with swatches; selected and `Edited` labels.
- Light notice when the resolved theme is light; the palette is stored and previewed but chrome keeps light tokens.
- Inert preview using the selected palette through `data-hq-token-scope`.
- Customize colors: a disclosure row below the preview (`aria-expanded`, `aria-controls="palette-editor"`; label `Customize colors` / `Hide colors`). Closed by default; open when the selected preset has edits, and it opens when you switch to an edited preset. Inside, the colour editor for the selected palette: Backgrounds, Buttons and accent, Selection and Text groups always open; `More colors` expands hover, pressed, disabled, focus and status roles. Each row has a colour picker, hex field, contrast ratio or `Low contrast … needs …` note, and Reset when edited.
- Invalid hex: field marked invalid, message names the colour still in use.
- Reset palette: inline confirmation; other palettes keep their edits.
- Storage failure: alert beside the editor plus the shell's storage notice; changes apply for the session.

## Contracts and consumers

Preset values, role labels and the role → `--hq-*` mapping live in [`@hq/ui` palettes](../../packages/hq-ui/src/palettes.ts); the stored shape and application live in [`appearance/`](../../apps/desktop/src/appearance). Every module consuming `--hq-*` roles follows the palette: the shell rail and footer, Settings, Design chrome (kit mode), References, Social and Work. Shared buttons, tabs, menus and pressed toggles take the common selection fill. Captures, producer previews and artwork keep their own colours.

## Checks

Unit and App journeys: `apps/desktop/src/appearance/*.test.*` (including `ThemeTiles.test.tsx` for radio semantics, arrow keys, System wording and tile colour scopes, and `theme-switch.test.tsx` for the view-transition guard under reduced motion), `apps/desktop/src/settings/settings-css.test.ts` (token-only styling), `packages/hq-ui/test/palettes.test.ts`, `packages/hq-ui/test/styles.test.ts`. The integrated production build, unit and App journeys passed. Headless production-renderer captures show all four presets at 760–1440px. Headless Chrome captures of the redesigned tiles and the Customize colors disclosure (1280×820 and 560×820, light and dark, plus a theme-switch frame strip) are indexed in the [after-20261103 evidence](../design/settings/evidence/after-20261103/README.md); they use a synthetic harness, not the installed app. Native Electron, installed app and real owner profile remain separate pending gates. Other module-owned selection styles listed in the [modernization spec](../engineering-specs/hq-ui-modernization.md) are not covered by this entry.

## Recovery checkpoint, 2026-11-12

The SET-V recovery composes the retained accepted redesign onto shell source `367cfb2159b85927bd04720c57d809e0970640ed`. All results and capture descriptions above are historical. No builds, tests, app launches or captures ran for this candidate. Layout, gutters, narrow states, text stress, keyboard, accessibility, reduced motion, light/dark/system, native behavior and gallery completion remain **unverified** at this head. Historical capture trees were deliberately excluded; no presentation was exported.
