import type { Appearance } from '@hq/contracts';
import { Panel, Row, SettingsHeading } from '../settings/parts';
import { PaletteSettings } from './PaletteSettings';
import { ThemeTiles } from './ThemeTiles';
import type { PaletteController } from './usePalette';

/** Settings › Appearance: theme tiles, dark palette presets and the colour editor. */
export function AppearancePanel({ headingId, appearance, onAppearanceChange, palette, dark }: {
  headingId: string; appearance: Appearance; onAppearanceChange?: (value: Appearance) => void;
  /** Dark palette presets and colour edits; `dark` is the resolved theme the palette applies to. */
  palette?: PaletteController; dark: boolean;
}) {
  return <>
    <SettingsHeading id={headingId} title="Appearance">Choose a light or dark workspace, or follow your device, and pick the colors HQ uses when it is dark. Captured designs, previews and artwork keep their own appearance.</SettingsHeading>
    <Panel>
      <Row title="Color theme" description="System follows changes to your device’s appearance.">
        <div className="theme-tiles-wrap"><ThemeTiles appearance={appearance} onChange={onAppearanceChange} {...(palette ? { colors: palette.colors } : {})} /></div>
      </Row>
    </Panel>
    {palette && <PaletteSettings palette={palette} dark={dark} />}
  </>;
}
