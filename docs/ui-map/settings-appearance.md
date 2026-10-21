# Settings › Appearance and dark palettes

Purpose: choose Light, Dark or System, and choose or edit the dark palette HQ uses whenever its resolved theme is dark.

## Entry points

- Rail → Settings → Appearance category.
- `hq-open-settings` window event with `detail.source = 'appearance'` (opens directly on Appearance).
- The rail appearance button cycles Light → Dark → System; it does not open Settings.

## States and subviews

- Color theme: Light / Dark / System pressed toggles (stored in `hq.appearance.v1`).
- Dark palette: radio group of Slate, Warm Graphite (initial), Harbor and Sage cards with swatches; selected and `Edited` labels.
- Light notice when the resolved theme is light; the palette is stored and previewed but chrome keeps light tokens.
- Inert preview using the selected palette through `data-hq-token-scope`.
- Colour editor for the selected palette: Backgrounds, Buttons and accent, Selection and Text groups always open; `More colors` expands hover, pressed, disabled, focus and status roles. Each row has a colour picker, hex field, contrast ratio or `Low contrast … needs …` note, and Reset when edited.
- Invalid hex: field marked invalid, message names the colour still in use.
- Reset palette: inline confirmation; other palettes keep their edits.
- Storage failure: alert beside the editor plus the shell's storage notice; changes apply for the session.

## Contracts and consumers

Preset values, role labels and the role → `--hq-*` mapping live in [`@hq/ui` palettes](../../packages/hq-ui/src/palettes.ts); the stored shape and application live in [`appearance/`](../../apps/desktop/src/appearance). Every module consuming `--hq-*` roles follows the palette: the shell rail and footer, Settings, Design chrome (kit mode), References, Social and Work. Shared buttons, tabs, menus and pressed toggles take the common selection fill. Captures, producer previews and artwork keep their own colours.

## Checks

Unit and App journeys: `apps/desktop/src/appearance/*.test.*`, `packages/hq-ui/test/palettes.test.ts`, `packages/hq-ui/test/styles.test.ts`. Runtime evidence for this entry is `unverified` until recorded against a candidate; native Electron, installed app and real owner profile are separate gates. Other module-owned selection styles listed in the [modernization spec](../engineering-specs/hq-ui-modernization.md) are not covered by this entry.
